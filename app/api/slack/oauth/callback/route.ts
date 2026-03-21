import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { encryptSecret } from "@/lib/crypto";
import { withTransaction } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { exchangeSlackOAuthCode } from "@/lib/slack/oauth";
import { verifySlackOAuthState } from "@/lib/slack/state";
import { enqueueSlackProvision } from "@/lib/queue";

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

  let statePayload: { accountId: string; nonce: string; issuedAt: number };
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
    const result = await withTransaction(async (tx) => {
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

      const installationRows = await tx<{ id: string }[]>`
        insert into slack_installations (
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
        returning id
      `;

      await tx`
        update chats
        set slack_status = 'provisioning',
            updated_at = now()
        where account_id = ${statePayload.accountId}::uuid
          and slack_status <> 'ready'
      `;

      const chats: Array<{ id: string }> = await tx`
        select id
        from chats
        where account_id = ${statePayload.accountId}::uuid
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
        installationId: installationRows[0]?.id ?? "",
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
      new URL(`/${result.accountSlug}/settings?slack=connected`, request.url),
    );
    response.cookies.delete("slack_oauth_nonce");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed Slack installation" }, { status: 500 });
  }
}
