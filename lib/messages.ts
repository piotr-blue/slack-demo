import { buildAssistantReply } from "@/lib/reply";
import { getDb, withTransaction } from "@/lib/db";
import { enqueueSlackOutbound } from "@/lib/queue";
import type { Message } from "@/lib/types";

export async function listMessagesForChat(input: {
  userId: string;
  chatId: string;
  limit?: number;
  beforeSortKey?: number;
}) {
  const db = getDb();
  const limit = Math.min(input.limit ?? 50, 100);
  const before = input.beforeSortKey ?? Number.MAX_SAFE_INTEGER;

  return db<Message[]>`
    select m.*
    from messages m
    join account_members am on am.account_id = m.account_id
    where m.chat_id = ${input.chatId}::uuid
      and am.user_id = ${input.userId}::uuid
      and m.sort_key < ${before}
    order by m.sort_key desc
    limit ${limit}
  `;
}

export async function createAppMessageFlow(input: {
  userId: string;
  chatId: string;
  text: string;
}) {
  const result = await withTransaction(async (tx) => {
    const membership = await tx`
      select
        c.id as chat_id,
        c.account_id,
        c.slack_status,
        c.slack_channel_id,
        p.display_name,
        si.id as installation_id
      from chats c
      join account_members am on am.account_id = c.account_id
      left join profiles p on p.id = ${input.userId}::uuid
      left join lateral (
        select id
        from slack_installations
        where account_id = c.account_id
        order by updated_at desc
        limit 1
      ) si on true
      where c.id = ${input.chatId}::uuid
        and am.user_id = ${input.userId}::uuid
      limit 1
    `;

    if (membership.length === 0) {
      throw new Error("Forbidden");
    }

    const context = membership[0] as {
      account_id: string;
      slack_status: "disconnected" | "provisioning" | "ready" | "error";
      slack_channel_id: string | null;
      installation_id: string | null;
      display_name: string | null;
    };

    const humanRows = await tx<Message[]>`
      insert into messages (
        account_id,
        chat_id,
        role,
        origin,
        author_user_id,
        author_display_name,
        text,
        metadata
      )
      values (
        ${context.account_id}::uuid,
        ${input.chatId}::uuid,
        'human',
        'app',
        ${input.userId}::uuid,
        ${context.display_name ?? "App User"},
        ${input.text},
        ${tx.json({ source: "app" })}
      )
      returning *
    `;
    const humanMessage = humanRows[0];

    const assistantText = buildAssistantReply(input.text);
    const assistantRows = await tx<Message[]>`
      insert into messages (
        account_id,
        chat_id,
        role,
        origin,
        text,
        metadata
      )
      values (
        ${context.account_id}::uuid,
        ${input.chatId}::uuid,
        'assistant',
        'system',
        ${assistantText},
        ${tx.json({ source: "assistant" })}
      )
      returning *
    `;
    const assistantMessage = assistantRows[0];

    const outboxIds: string[] = [];
    const canMirrorToSlack =
      context.slack_status === "ready" &&
      Boolean(context.slack_channel_id) &&
      Boolean(context.installation_id);

    if (canMirrorToSlack) {
      const outboxRows = await tx<{ id: string }[]>`
        insert into slack_outbox (
          account_id,
          chat_id,
          message_id,
          installation_id,
          channel_id,
          kind,
          status
        )
        values
          (
            ${context.account_id}::uuid,
            ${input.chatId}::uuid,
            ${humanMessage.id}::uuid,
            ${context.installation_id}::uuid,
            ${context.slack_channel_id!},
            'mirror_message',
            'pending'
          ),
          (
            ${context.account_id}::uuid,
            ${input.chatId}::uuid,
            ${assistantMessage.id}::uuid,
            ${context.installation_id}::uuid,
            ${context.slack_channel_id!},
            'mirror_message',
            'pending'
          )
        on conflict (message_id, kind) do update
        set updated_at = now()
        returning id
      `;
      for (const row of outboxRows) {
        outboxIds.push(row.id);
      }
    }

    return {
      humanMessage,
      assistantMessage,
      outboxIds,
    };
  });

  await Promise.all(
    result.outboxIds.map((outboxId) =>
      enqueueSlackOutbound(
        { outboxId },
        { idempotencyKey: `outbox:${outboxId}` },
      ),
    ),
  );

  return result;
}
