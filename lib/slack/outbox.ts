import { ErrorCode, type WebAPICallResult } from "@slack/web-api";
import { withTransaction } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { createSlackClient } from "@/lib/slack/client";
import {
  buildSlackThreadRootMessage,
  formatSlackMirrorMessage,
} from "@/lib/slack/message-format";

type DispatchResult =
  | { status: "done" }
  | { status: "retry"; delaySeconds: number }
  | { status: "missing" };

type OutboxWithMessage = {
  id: string;
  account_id: string;
  chat_id: string;
  chat_name: string;
  installation_id: string | null;
  channel_id: string | null;
  thread_ts: string | null;
  chat_thread_ts: string | null;
  slack_user_link_id: string | null;
  slack_user_id: string | null;
  slack_dm_channel_id: string | null;
  status: "pending" | "sent" | "failed" | "retrying";
  attempts: number;
  next_attempt_at: string;
  bot_token_encrypted: string | null;
  message_text: string | null;
  message_role: "human" | "assistant" | "system" | null;
  message_origin: "app" | "slack" | "system" | null;
  author_display_name: string | null;
};

function secondsUntil(target: Date, now: Date) {
  const ms = target.getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

function getRetryAfterSeconds(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const maybeRetryAfter = (error as { retryAfter?: number }).retryAfter;
    if (typeof maybeRetryAfter === "number" && maybeRetryAfter > 0) {
      return Math.ceil(maybeRetryAfter);
    }
  }
  return null;
}

export async function dispatchSlackOutbox(outboxId: string): Promise<DispatchResult> {
  return withTransaction(async (tx) => {
    const rows = await tx<OutboxWithMessage[]>`
      select
        so.id,
        so.account_id,
        so.chat_id,
        c.name as chat_name,
        so.installation_id,
        so.channel_id,
        so.thread_ts,
        c.slack_thread_ts as chat_thread_ts,
        so.slack_user_link_id,
        sul.slack_user_id,
        sul.slack_dm_channel_id,
        so.status,
        so.attempts,
        so.next_attempt_at,
        ws.bot_token_encrypted,
        m.text as message_text,
        m.role as message_role,
        m.origin as message_origin,
        m.author_display_name
      from slack_outbox so
      join chats c on c.id = so.chat_id
      left join slack_user_links sul on sul.id = so.slack_user_link_id
      left join slack_workspace_installations ws on ws.id = so.installation_id
      left join messages m on m.id = so.message_id
      where so.id = ${outboxId}::uuid
      limit 1
      for update
    `;

    const row = rows[0];
    if (!row) {
      return { status: "missing" };
    }
    if (row.status === "sent") {
      return { status: "done" };
    }

    const now = new Date();
    const nextAttempt = new Date(row.next_attempt_at);
    if (nextAttempt > now) {
      return { status: "retry", delaySeconds: secondsUntil(nextAttempt, now) };
    }

    if (
      !row.installation_id ||
      !row.bot_token_encrypted ||
      !row.slack_user_link_id ||
      !row.slack_user_id
    ) {
      await tx`
        update slack_outbox
        set status = 'failed',
            attempts = attempts + 1,
            last_error = 'Missing Slack installation or user link context',
            updated_at = now()
        where id = ${outboxId}::uuid
      `;
      await tx`
        update chats
        set slack_status = 'error',
            slack_last_error = 'Missing Slack installation or user link context',
            updated_at = now()
        where id = ${row.chat_id}::uuid
      `;
      return { status: "done" };
    }

    const botToken = decryptSecret(row.bot_token_encrypted);
    const client = createSlackClient(botToken);
    let channelId = row.channel_id ?? row.slack_dm_channel_id;

    try {
      if (!channelId) {
        const openResponse = await client.conversations.open({
          users: row.slack_user_id,
        });
        channelId = openResponse.channel?.id ?? null;
        if (!channelId) {
          await tx`
            update slack_outbox
            set status = 'failed',
                attempts = attempts + 1,
                last_error = 'Slack did not return DM channel id',
                updated_at = now()
            where id = ${outboxId}::uuid
          `;
          await tx`
            update chats
            set slack_status = 'error',
                slack_last_error = 'Slack did not return DM channel id',
                updated_at = now()
            where id = ${row.chat_id}::uuid
          `;
          return { status: "done" };
        }

        await tx`
          update slack_user_links
          set slack_dm_channel_id = ${channelId},
              last_error = null,
              updated_at = now()
          where id = ${row.slack_user_link_id}::uuid
        `;
        await tx`
          update slack_outbox
          set channel_id = ${channelId}
          where id = ${outboxId}::uuid
        `;
      }

      const lockRows = await tx<{ locked: boolean }[]>`
        select pg_try_advisory_xact_lock(
          hashtext(${row.installation_id}),
          hashtext(${channelId})
        ) as locked
      `;
      if (!lockRows[0]?.locked) {
        return { status: "retry", delaySeconds: 1 };
      }

      const workspaceRows = await tx<{ next_allowed_at: string }[]>`
        insert into slack_workspace_throttle (installation_id, next_allowed_at)
        values (${row.installation_id}::uuid, now())
        on conflict (installation_id) do update
        set next_allowed_at = slack_workspace_throttle.next_allowed_at
        returning next_allowed_at
      `;
      const channelRows = await tx<{ next_allowed_at: string }[]>`
        insert into slack_channel_throttle (installation_id, channel_id, next_allowed_at)
        values (${row.installation_id}::uuid, ${channelId}, now())
        on conflict (installation_id, channel_id) do update
        set next_allowed_at = slack_channel_throttle.next_allowed_at
        returning next_allowed_at
      `;

      const workspaceAllowedAt = new Date(workspaceRows[0].next_allowed_at);
      const channelAllowedAt = new Date(channelRows[0].next_allowed_at);
      const throttleUntil = workspaceAllowedAt > channelAllowedAt ? workspaceAllowedAt : channelAllowedAt;
      if (throttleUntil > now) {
        await tx`
          update slack_outbox
          set status = 'retrying',
              next_attempt_at = ${throttleUntil.toISOString()}::timestamptz
          where id = ${outboxId}::uuid
        `;
        return { status: "retry", delaySeconds: secondsUntil(throttleUntil, now) };
      }

      let threadTs = row.thread_ts ?? row.chat_thread_ts;
      if (!threadTs) {
        const rootResponse = await client.chat.postMessage({
          channel: channelId,
          text: buildSlackThreadRootMessage(row.chat_name),
        });
        threadTs = rootResponse.ts ?? null;
        if (!threadTs) {
          throw new Error("Slack did not return root thread timestamp");
        }

        await tx`
          update chats
          set slack_thread_ts = ${threadTs},
              slack_status = 'ready',
              slack_last_error = null,
              updated_at = now()
          where id = ${row.chat_id}::uuid
        `;
        await tx`
          update slack_outbox
          set thread_ts = ${threadTs}
          where chat_id = ${row.chat_id}::uuid
            and slack_user_link_id = ${row.slack_user_link_id}::uuid
            and thread_ts is null
            and status in ('pending', 'retrying')
        `;
      }

      const text = formatSlackMirrorMessage({
        chatName: row.chat_name,
        role: row.message_role,
        origin: row.message_origin,
        text: row.message_text,
        authorDisplayName: row.author_display_name,
      });
      if (!text) {
        await tx`
          update slack_outbox
          set status = 'failed',
              last_error = 'Missing message text',
              attempts = attempts + 1
          where id = ${outboxId}::uuid
        `;
        return { status: "done" };
      }

      const response = (await client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts: threadTs,
      })) as WebAPICallResult & { ts?: string };

      await tx`
        update slack_outbox
        set status = 'sent',
            attempts = attempts + 1,
            external_message_ts = ${response.ts ?? null},
            updated_at = now(),
            last_error = null
        where id = ${outboxId}::uuid
      `;
      await tx`
        update chats
        set slack_status = 'ready',
            slack_last_error = null,
            updated_at = now()
        where id = ${row.chat_id}::uuid
      `;
      await tx`
        update slack_workspace_throttle
        set next_allowed_at = now() + interval '1 second'
        where installation_id = ${row.installation_id}::uuid
      `;
      await tx`
        update slack_channel_throttle
        set next_allowed_at = now() + interval '1 second'
        where installation_id = ${row.installation_id}::uuid
          and channel_id = ${channelId}
      `;
      return { status: "done" };
    } catch (error) {
      const retryAfter = getRetryAfterSeconds(error);
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === ErrorCode.RateLimitedError
      ) {
        const delaySeconds = retryAfter ?? 30;
        await tx`
          update slack_outbox
          set status = 'retrying',
              attempts = attempts + 1,
              next_attempt_at = now() + (${delaySeconds}::text || ' seconds')::interval,
              last_error = 'rate_limited',
              updated_at = now()
          where id = ${outboxId}::uuid
        `;
        await tx`
          update slack_workspace_throttle
          set next_allowed_at = now() + (${delaySeconds}::text || ' seconds')::interval
          where installation_id = ${row.installation_id}::uuid
        `;
        if (channelId) {
          await tx`
            update slack_channel_throttle
            set next_allowed_at = now() + (${delaySeconds}::text || ' seconds')::interval
            where installation_id = ${row.installation_id}::uuid
              and channel_id = ${channelId}
          `;
        }
        return { status: "retry", delaySeconds };
      }

      const attempt = row.attempts + 1;
      const terminal = attempt >= 8;
      const delaySeconds = Math.min(300, 2 ** attempt);
      await tx`
        update slack_outbox
        set status = ${terminal ? "failed" : "retrying"},
            attempts = attempts + 1,
            next_attempt_at = now() + (${delaySeconds}::text || ' seconds')::interval,
            last_error = ${String(error)},
            updated_at = now()
        where id = ${outboxId}::uuid
      `;
      await tx`
        update chats
        set slack_status = 'error',
            slack_last_error = ${String(error)},
            updated_at = now()
        where id = ${row.chat_id}::uuid
      `;

      return terminal ? { status: "done" } : { status: "retry", delaySeconds };
    }
  });
}
