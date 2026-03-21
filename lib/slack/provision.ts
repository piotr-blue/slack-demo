import { ErrorCode } from "@slack/web-api";
import { withTransaction } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { createSlackClient } from "@/lib/slack/client";
import { buildSlackChannelName } from "@/lib/slack/channel-name";

type ProvisionContext = {
  chat_id: string;
  account_id: string;
  chat_slug: string;
  account_slug: string;
  installation_id: string | null;
  bot_token_encrypted: string | null;
  existing_channel_id: string | null;
  existing_channel_name: string | null;
};

async function resolveProvisionContext(chatId: string) {
  return withTransaction(async (tx) => {
    const rows = await tx<ProvisionContext[]>`
      select
        c.id as chat_id,
        c.account_id,
        c.slug as chat_slug,
        a.slug as account_slug,
        si.id as installation_id,
        si.bot_token_encrypted,
        c.slack_channel_id as existing_channel_id,
        c.slack_channel_name as existing_channel_name
      from chats c
      join accounts a on a.id = c.account_id
      left join lateral (
        select id, bot_token_encrypted
        from slack_installations
        where account_id = c.account_id
        order by updated_at desc
        limit 1
      ) si on true
      where c.id = ${chatId}::uuid
      limit 1
      for update
    `;

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  });
}

async function findPublicChannelByName(botToken: string, name: string) {
  const client = createSlackClient(botToken);
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const response = await client.conversations.list({
      types: "public_channel",
      limit: 100,
      cursor,
      exclude_archived: true,
    });
    const match = response.channels?.find((channel) => channel.name === name);
    if (match?.id) {
      return { id: match.id, name: match.name ?? name };
    }
    if (!response.response_metadata?.next_cursor) {
      break;
    }
    cursor = response.response_metadata.next_cursor;
  }

  return null;
}

export async function provisionSlackChannelForChat(chatId: string) {
  const context = await resolveProvisionContext(chatId);
  if (!context) {
    return { status: "missing" as const };
  }
  if (!context.installation_id || !context.bot_token_encrypted) {
    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'disconnected',
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "skipped" as const };
  }
  if (context.existing_channel_id && context.existing_channel_name) {
    return { status: "already-ready" as const };
  }

  const desiredChannelName = buildSlackChannelName({
    accountSlug: context.account_slug,
    chatSlug: context.chat_slug,
  });
  let botToken: string | null = null;

  try {
    botToken = decryptSecret(context.bot_token_encrypted);
    const client = createSlackClient(botToken);
    const response = await client.conversations.create({
      is_private: false,
      name: desiredChannelName,
    });
    const channelId = response.channel?.id;
    const channelName = response.channel?.name ?? desiredChannelName;
    if (!channelId) {
      throw new Error("Slack did not return channel id");
    }

    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'ready',
            slack_channel_id = ${channelId},
            slack_channel_name = ${channelName},
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "ready" as const };
  } catch (error) {
    const nameTaken =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === ErrorCode.PlatformError &&
      "data" in error &&
      (error as { data?: { error?: string } }).data?.error === "name_taken";

    if (nameTaken && botToken) {
      const existing = await findPublicChannelByName(botToken, desiredChannelName);
      if (existing?.id) {
        await withTransaction(async (tx) => {
          await tx`
            update chats
            set slack_status = 'ready',
                slack_channel_id = ${existing.id},
                slack_channel_name = ${existing.name},
                updated_at = now()
            where id = ${chatId}::uuid
          `;
        });
        return { status: "ready" as const };
      }
    }

    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'error',
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    console.error("Slack provisioning failed", {
      chatId,
      desiredChannelName,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "error" as const };
  }
}
