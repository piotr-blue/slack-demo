import { withTransaction } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { createSlackClient } from "@/lib/slack/client";
import { buildSlackThreadRootMessage } from "@/lib/slack/message-format";

type ProvisionContext = {
  chat_id: string;
  account_id: string;
  chat_name: string;
  owner_user_id: string;
  thread_ts: string | null;
  user_link_id: string | null;
  slack_user_id: string | null;
  slack_dm_channel_id: string | null;
  team_id: string | null;
  installation_id: string | null;
  bot_token_encrypted: string | null;
};

async function resolveProvisionContext(chatId: string) {
  return withTransaction(async (tx) => {
    const rows = await tx<ProvisionContext[]>`
      select
        c.id as chat_id,
        c.account_id,
        c.name as chat_name,
        c.owner_user_id,
        c.slack_thread_ts as thread_ts,
        ws.id as installation_id,
        ws.team_id,
        ws.bot_token_encrypted,
        sul.id as user_link_id,
        sul.slack_user_id,
        sul.slack_dm_channel_id
      from chats c
      left join lateral (
        select id, team_id, bot_token_encrypted
        from slack_workspace_installations
        where account_id = c.account_id
        order by updated_at desc
        limit 1
      ) ws on true
      left join slack_user_links sul
        on sul.account_id = c.account_id
       and sul.app_user_id = c.owner_user_id
       and sul.slack_team_id = ws.team_id
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

export async function provisionSlackDmThreadForChat(chatId: string) {
  const context = await resolveProvisionContext(chatId);
  if (!context) {
    return { status: "missing" as const };
  }
  if (!context.installation_id || !context.bot_token_encrypted) {
    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'disconnected',
            slack_last_error = 'Slack workspace is not connected',
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "skipped" as const };
  }

  if (!context.user_link_id || !context.slack_user_id || !context.team_id) {
    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'disconnected',
            slack_last_error = 'Slack user is not linked',
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "skipped" as const };
  }

  if (context.slack_dm_channel_id && context.thread_ts) {
    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'ready',
            slack_last_error = null,
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "already-ready" as const };
  }

  try {
    const botToken = decryptSecret(context.bot_token_encrypted);
    const client = createSlackClient(botToken);

    let dmChannelId = context.slack_dm_channel_id;
    if (!dmChannelId) {
      const dmResponse = await client.conversations.open({
        users: context.slack_user_id,
      });
      dmChannelId = dmResponse.channel?.id ?? null;
      if (!dmChannelId) {
        throw new Error("Slack did not return DM channel id");
      }
    }

    let threadTs = context.thread_ts;
    if (!threadTs) {
      const rootMessage = await client.chat.postMessage({
        channel: dmChannelId,
        text: buildSlackThreadRootMessage(context.chat_name),
      });
      threadTs = rootMessage.ts ?? null;
      if (!threadTs) {
        throw new Error("Slack did not return root thread ts");
      }
    }

    await withTransaction(async (tx) => {
      await tx`
        update slack_user_links
        set slack_dm_channel_id = ${dmChannelId},
            last_error = null,
            updated_at = now()
        where id = ${context.user_link_id}::uuid
      `;
      await tx`
        update chats
        set slack_status = 'ready',
            slack_thread_ts = ${threadTs},
            slack_last_error = null,
            updated_at = now()
        where id = ${chatId}::uuid
      `;
    });
    return { status: "ready" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await withTransaction(async (tx) => {
      await tx`
        update chats
        set slack_status = 'error',
            slack_last_error = ${message},
            updated_at = now()
        where id = ${chatId}::uuid
      `;
      await tx`
        update slack_user_links
        set last_error = ${message},
            updated_at = now()
        where id = ${context.user_link_id}::uuid
      `;
    });
    console.error("Slack DM/thread provisioning failed", {
      chatId,
      error: message,
    });
    return { status: "error" as const };
  }
}
