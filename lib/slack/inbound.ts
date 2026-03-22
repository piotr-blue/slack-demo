import { withTransaction } from "@/lib/db";
import { buildAssistantReply } from "@/lib/reply";
import { enqueueSlackOutbound } from "@/lib/queue";
import type { SlackEventEnvelope } from "@/lib/slack/types";

function isSlackHumanMessageEvent(envelope: SlackEventEnvelope) {
  if (envelope.type !== "event_callback") return false;
  if (!envelope.event_id || !envelope.team_id) return false;
  const event = envelope.event;
  if (!event || event.type !== "message") return false;
  if (!event.channel || !event.user || !event.text) return false;
  if (event.channel_type && event.channel_type !== "im") return false;
  if (!event.channel.startsWith("D")) return false;
  if (event.subtype) return false;
  if (event.bot_id) return false;
  return true;
}

export async function processSlackInboundEvent(envelope: SlackEventEnvelope) {
  if (!isSlackHumanMessageEvent(envelope)) {
    return { ignored: true as const };
  }

  const { event_id: eventId, team_id: teamId } = envelope;
  const event = envelope.event!;
  const channel = event.channel as string;
  const slackUser = event.user as string;
  const text = event.text as string;
  const eventThreadTs = (event.thread_ts as string | undefined) ?? null;

  const result = await withTransaction(async (tx) => {
    const insertedReceipt = await tx<{ event_id: string }[]>`
      insert into slack_event_receipts (event_id, team_id, event_type)
      values (${eventId!}, ${teamId!}, ${event.type!})
      on conflict (event_id) do nothing
      returning event_id
    `;

    if (insertedReceipt.length === 0) {
      return { ignored: true as const };
    }

    const linkRows = await tx<{
      slack_user_link_id: string;
      account_id: string;
      app_user_id: string;
      active_chat_id: string | null;
      dm_channel_id: string | null;
      installation_id: string;
      bot_user_id: string | null;
    }[]>`
      select
        sul.id as slack_user_link_id,
        sul.account_id,
        sul.app_user_id,
        sul.active_chat_id,
        sul.slack_dm_channel_id as dm_channel_id,
        ws.id as installation_id,
        ws.bot_user_id
      from slack_user_links sul
      join slack_workspace_installations ws
        on ws.account_id = sul.account_id
       and ws.team_id = sul.slack_team_id
      where sul.slack_team_id = ${teamId!}
        and sul.slack_user_id = ${slackUser}
      order by ws.updated_at desc
      limit 1
    `;

    const link = linkRows[0];
    if (!link) {
      return { ignored: true as const };
    }

    if (link.bot_user_id && event.user === link.bot_user_id) {
      return { ignored: true as const };
    }

    if (!link.dm_channel_id || link.dm_channel_id !== channel) {
      await tx`
        update slack_user_links
        set slack_dm_channel_id = ${channel},
            updated_at = now(),
            last_error = null
        where id = ${link.slack_user_link_id}::uuid
      `;
    }

    let chatRows: Array<{ chat_id: string; slack_thread_ts: string | null }> = [];
    if (eventThreadTs) {
      chatRows = await tx`
        select id as chat_id, slack_thread_ts
        from chats
        where account_id = ${link.account_id}::uuid
          and owner_user_id = ${link.app_user_id}::uuid
          and slack_thread_ts = ${eventThreadTs}
        limit 1
      `;
    }

    if (chatRows.length === 0 && link.active_chat_id) {
      chatRows = await tx`
        select id as chat_id, slack_thread_ts
        from chats
        where id = ${link.active_chat_id}::uuid
          and account_id = ${link.account_id}::uuid
          and owner_user_id = ${link.app_user_id}::uuid
        limit 1
      `;
    }

    const chat = chatRows[0];
    if (!chat) {
      await tx`
        update slack_user_links
        set last_error = 'No active chat mapping for inbound DM',
            updated_at = now()
        where id = ${link.slack_user_link_id}::uuid
      `;
      return { ignored: true as const };
    }

    if (eventThreadTs && !chat.slack_thread_ts) {
      await tx`
        update chats
        set slack_thread_ts = ${eventThreadTs},
            slack_status = 'ready',
            slack_last_error = null,
            updated_at = now()
        where id = ${chat.chat_id}::uuid
      `;
    }

    await tx`
      update slack_user_links
      set active_chat_id = ${chat.chat_id}::uuid,
          last_error = null,
          updated_at = now()
      where id = ${link.slack_user_link_id}::uuid
    `;

    const humanMessageRows = await tx<{ id: string; text: string }[]>`
      insert into messages (
        account_id,
        chat_id,
        role,
        origin,
        author_user_id,
        slack_user_id,
        text,
        metadata
      )
      values (
        ${link.account_id}::uuid,
        ${chat.chat_id}::uuid,
        'human',
        'slack',
        ${link.app_user_id}::uuid,
        ${slackUser},
        ${text},
        ${tx.json({ source: "slack" })}
      )
      returning id, text
    `;

    const assistantText = buildAssistantReply(humanMessageRows[0].text);
    const assistantRows = await tx<{ id: string }[]>`
      insert into messages (
        account_id,
        chat_id,
        role,
        origin,
        text,
        metadata
      )
      values (
        ${link.account_id}::uuid,
        ${chat.chat_id}::uuid,
        'assistant',
        'system',
        ${assistantText},
        ${tx.json({ source: "assistant" })}
      )
      returning id
    `;

    const outboxRows: Array<{ id: string }> = await tx`
      insert into slack_outbox (
        account_id,
        chat_id,
        message_id,
        slack_user_link_id,
        installation_id,
        channel_id,
        thread_ts,
        kind,
        status
      )
      values (
        ${link.account_id}::uuid,
        ${chat.chat_id}::uuid,
        ${assistantRows[0].id}::uuid,
        ${link.slack_user_link_id}::uuid,
        ${link.installation_id}::uuid,
        ${channel},
        ${eventThreadTs ?? chat.slack_thread_ts},
        'mirror_message',
        'pending'
      )
      on conflict (message_id, kind) do update set updated_at = now()
      returning id
    `;

    return {
      ignored: false as const,
      outboxIds: outboxRows.map((row: { id: string }) => row.id),
    };
  });

  if (result.ignored) {
    return result;
  }

  await Promise.all(
    result.outboxIds.map((outboxId: string) =>
      enqueueSlackOutbound(
        { outboxId },
        { idempotencyKey: `outbox:${outboxId}` },
      ),
    ),
  );

  return { ignored: false as const };
}
