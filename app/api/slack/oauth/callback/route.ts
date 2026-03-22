import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { withTransaction } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { exchangeSlackOAuthCode } from "@/lib/slack/oauth";
import { verifySlackOAuthState } from "@/lib/slack/state";
import { enqueueSlackProvision } from "@/lib/queue";
import { createSlackClient } from "@/lib/slack/client";

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) {
    return auth.response!;
  }

  const url = new URL(request.url);
  const parsed = callbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid callback payload" }, { status: 400 });
  }

  let statePayload: {
    accountId: string;
    intent: "workspace_install" | "user_link";
    nonce: string;
    issuedAt: number;
  };
  try {
    statePayload = verifySlackOAuthState(parsed.data.state);
  } catch {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const nonceCookie = cookieStore.get("slack_oauth_nonce")?.value;
  if (!nonceCookie || nonceCookie !== statePayload.nonce) {
    return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
  }

  const env = getServerEnv();
  const oauth = await exchangeSlackOAuthCode({
    code: parsed.data.code,
    redirectUri: `${env.APP_URL}/api/slack/oauth/callback`,
  });

  try {
    if (statePayload.intent === "workspace_install") {
      const result = await withTransaction(async (tx) => {
        const membership = await tx<{ role: "owner" }[]>`
          select role
          from account_members
          where account_id = ${statePayload.accountId}::uuid
            and user_id = ${auth.user.id}::uuid
          limit 1
        `;
        if (membership.length === 0 || membership[0].role !== "owner") {
          throw new Error("Forbidden");
        }

        await tx`
          insert into slack_workspace_installations (
            account_id,
            team_id,
            team_name,
            bot_token_encrypted,
            bot_user_id,
            scope,
            connected_by_user_id
          )
          values (
            ${statePayload.accountId}::uuid,
            ${oauth.teamId},
            ${oauth.teamName},
            ${encryptSecret(oauth.botToken)},
            ${oauth.botUserId},
            ${oauth.scope},
            ${auth.user.id}::uuid
          )
          on conflict (account_id, team_id) do update
          set team_name = excluded.team_name,
              bot_token_encrypted = excluded.bot_token_encrypted,
              bot_user_id = excluded.bot_user_id,
              scope = excluded.scope,
              connected_by_user_id = excluded.connected_by_user_id,
              updated_at = now()
        `;

        const chats: Array<{ id: string }> = await tx`
          select c.id
          from chats c
          join slack_user_links sul
            on sul.account_id = c.account_id
           and sul.app_user_id = c.owner_user_id
           and sul.slack_team_id = ${oauth.teamId}
          where c.account_id = ${statePayload.accountId}::uuid
        `;

        await tx`
          update chats
          set slack_status = 'provisioning',
              slack_last_error = null,
              updated_at = now()
          where id in (
            select c.id
            from chats c
            join slack_user_links sul
              on sul.account_id = c.account_id
             and sul.app_user_id = c.owner_user_id
             and sul.slack_team_id = ${oauth.teamId}
            where c.account_id = ${statePayload.accountId}::uuid
          )
        `;

        const accountRows: Array<{ slug: string }> = await tx`
          select slug
          from accounts
          where id = ${statePayload.accountId}::uuid
          limit 1
        `;

        return {
          chatIds: chats.map((chat: { id: string }) => chat.id),
          accountSlug: accountRows[0]?.slug ?? "",
        };
      });

      await Promise.all(
        result.chatIds.map((chatId: string) =>
          enqueueSlackProvision(
            { chatId },
            { idempotencyKey: `provision:${chatId}` },
          ),
        ),
      );

      const response = NextResponse.redirect(
        new URL(`/${result.accountSlug}/settings?slack=workspace-connected`, request.url),
      );
      response.cookies.delete("slack_oauth_nonce");
      return response;
    }

    const initial = await withTransaction(async (tx) => {
      const membership = await tx`
        select 1
        from account_members
        where account_id = ${statePayload.accountId}::uuid
          and user_id = ${auth.user.id}::uuid
        limit 1
      `;
      if (membership.length === 0) {
        throw new Error("Forbidden");
      }

      const workspaceRows = await tx<{ bot_token_encrypted: string; team_id: string }[]>`
        select bot_token_encrypted, team_id
        from slack_workspace_installations
        where account_id = ${statePayload.accountId}::uuid
          and team_id = ${oauth.teamId}
        order by updated_at desc
        limit 1
      `;
      if (workspaceRows.length === 0) {
        throw new Error("WorkspaceNotConnected");
      }

      const accountRows: Array<{ slug: string }> = await tx`
        select slug
        from accounts
        where id = ${statePayload.accountId}::uuid
        limit 1
      `;

      return {
        teamId: workspaceRows[0].team_id,
        workspaceBotToken: decryptSecret(workspaceRows[0].bot_token_encrypted),
        accountSlug: accountRows[0]?.slug ?? "",
      };
    });

    if (!oauth.authedUserId) {
      return NextResponse.json(
        { error: "Slack did not return user identity for linking" },
        { status: 400 },
      );
    }

    const client = createSlackClient(initial.workspaceBotToken);
    const dmOpenResponse = await client.conversations.open({
      users: oauth.authedUserId,
    });
    const dmChannelId = dmOpenResponse.channel?.id ?? null;
    if (!dmChannelId) {
      return NextResponse.json(
        { error: "Failed to open Slack DM for linked user" },
        { status: 500 },
      );
    }

    const result = await withTransaction(async (tx) => {
      await tx`
        delete from slack_user_links
        where account_id = ${statePayload.accountId}::uuid
          and slack_team_id = ${initial.teamId}
          and (
            app_user_id = ${auth.user.id}::uuid
            or slack_user_id = ${oauth.authedUserId}
          )
      `;

      const linkRows = await tx<{ id: string }[]>`
        insert into slack_user_links (
          account_id,
          app_user_id,
          slack_team_id,
          slack_user_id,
          slack_dm_channel_id,
          last_error
        )
        values (
          ${statePayload.accountId}::uuid,
          ${auth.user.id}::uuid,
          ${initial.teamId},
          ${oauth.authedUserId},
          ${dmChannelId},
          null
        )
        returning id
      `;

      const chats: Array<{ id: string }> = await tx`
        select id
        from chats
        where account_id = ${statePayload.accountId}::uuid
          and owner_user_id = ${auth.user.id}::uuid
      `;

      await tx`
        update chats
        set slack_status = 'provisioning',
            slack_last_error = null,
            updated_at = now()
        where account_id = ${statePayload.accountId}::uuid
          and owner_user_id = ${auth.user.id}::uuid
      `;

      return {
        chatIds: chats.map((chat: { id: string }) => chat.id),
        accountSlug: initial.accountSlug,
        userLinkId: linkRows[0]?.id ?? "",
      };
    });

    await Promise.all(
      result.chatIds.map((chatId: string) =>
        enqueueSlackProvision(
          { chatId },
          { idempotencyKey: `provision:${chatId}` },
        ),
      ),
    );

    const response = NextResponse.redirect(
      new URL(`/${result.accountSlug}/settings?slack=linked`, request.url),
    );
    response.cookies.delete("slack_oauth_nonce");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "WorkspaceNotConnected") {
      return NextResponse.json(
        { error: "Connect workspace to Slack before linking your user" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Failed Slack OAuth callback handling" }, { status: 500 });
  }
}
