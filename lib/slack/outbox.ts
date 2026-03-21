import { ErrorCode, type WebAPICallResult } from "@slack/web-api";
import { withTransaction } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { createSlackClient } from "@/lib/slack/client";

type DispatchResult =
  | { status: "done" }
  | { status: "retry"; delaySeconds: number }
  | { status: "missing" };

type OutboxWithMessage = {
  id: string;
  installation_id: string;
  channel_id: string;
  status: "pending" | "sent" | "failed" | "retrying";
  attempts: number;
  next_attempt_at: string;
  bot_token_encrypted: string;
  message_text: string | null;
  message_role: "human" | "assistant" | "system" | null;
  message_origin: "app" | "slack" | "system" | null;
  author_display_name: string | null;
};

function secondsUntil(target: Date, now: Date) {
  const ms = target.getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

function formatOutboundMessage(row: OutboxWithMessage) {
  if (!row.message_text) {
    return null;
  }

  if (row.message_role === "assistant") {
    return row.message_text;
  }

  if (row.message_role === "human" && row.message_origin === "app") {
    const author = row.author_display_name ?? "App User";
    return `[App] ${author}: ${row.message_text}`;
  }

  return row.message_text;
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
        so.installation_id,
        so.channel_id,
        so.status,
        so.attempts,
        so.next_attempt_at,
        si.bot_token_encrypted,
        m.text as message_text,
        m.role as message_role,
        m.origin as message_origin,
        m.author_display_name
      from slack_outbox so
      join slack_installations si on si.id = so.installation_id
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

    const lockRows = await tx<{ locked: boolean }[]>`
      select pg_try_advisory_xact_lock(
        hashtext(${row.installation_id}),
        hashtext(${row.channel_id})
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
      values (${row.installation_id}::uuid, ${row.channel_id}, now())
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

    const text = formatOutboundMessage(row);
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

    const botToken = decryptSecret(row.bot_token_encrypted);
    const client = createSlackClient(botToken);

    try {
      const response = (await client.chat.postMessage({
        channel: row.channel_id,
        text,
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
        update slack_workspace_throttle
        set next_allowed_at = now() + interval '1 second'
        where installation_id = ${row.installation_id}::uuid
      `;
      await tx`
        update slack_channel_throttle
        set next_allowed_at = now() + interval '1 second'
        where installation_id = ${row.installation_id}::uuid
          and channel_id = ${row.channel_id}
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
        await tx`
          update slack_channel_throttle
          set next_allowed_at = now() + (${delaySeconds}::text || ' seconds')::interval
          where installation_id = ${row.installation_id}::uuid
            and channel_id = ${row.channel_id}
        `;
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

      return terminal ? { status: "done" } : { status: "retry", delaySeconds };
    }
  });
}
