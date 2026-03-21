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

    const chatRows = await tx<{
      chat_id: string;
      account_id: string;
      installation_id: string;
      bot_user_id: string | null;
      channel_id: string;
    }[]>`
      select
        c.id as chat_id,
        c.account_id,
        si.id as installation_id,
        si.bot_user_id,
        c.slack_channel_id as channel_id
      from chats c
      join slack_installations si on si.account_id = c.account_id
      where c.slack_channel_id = ${channel}
        and si.team_id = ${teamId!}
      order by si.updated_at desc
      limit 1
    `;

    const chat = chatRows[0];
    if (!chat) {
      return { ignored: true as const };
    }

    if (chat.bot_user_id && event.user === chat.bot_user_id) {
      return { ignored: true as const };
    }

    const humanMessageRows = await tx<{ id: string; text: string }[]>`
      insert into messages (
        account_id,
        chat_id,
        role,
        origin,
        slack_user_id,
        text,
        metadata
      )
      values (
        ${chat.account_id}::uuid,
        ${chat.chat_id}::uuid,
        'human',
        'slack',
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
        ${chat.account_id}::uuid,
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
        installation_id,
        channel_id,
        kind,
        status
      )
      values (
        ${chat.account_id}::uuid,
        ${chat.chat_id}::uuid,
        ${assistantRows[0].id}::uuid,
        ${chat.installation_id}::uuid,
        ${chat.channel_id!},
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
