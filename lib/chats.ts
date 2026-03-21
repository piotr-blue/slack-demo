import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { getDb, withTransaction } from "@/lib/db";
import { ensureSlug } from "@/lib/slug";
import type { Chat } from "@/lib/types";
import { enqueueSlackProvision } from "@/lib/queue";

async function createUniqueChatSlug(tx: Sql, accountId: string, name: string) {
  const base = ensureSlug(name, "chat");
  const candidates = [base, `${base}-${randomUUID().slice(0, 6)}`];

  for (const slug of candidates) {
    const existing = await tx`
      select id from chats where account_id = ${accountId}::uuid and slug = ${slug} limit 1
    `;
    if (existing.length === 0) {
      return slug;
    }
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function listChatsForAccount(accountId: string): Promise<Chat[]> {
  const db = getDb();
  return db<Chat[]>`
    select *
    from chats
    where account_id = ${accountId}::uuid
    order by created_at asc
  `;
}

export async function getChatForUser(userId: string, chatId: string) {
  const db = getDb();
  const rows = await db<Chat[]>`
    select c.*
    from chats c
    join account_members am on am.account_id = c.account_id
    where c.id = ${chatId}::uuid
      and am.user_id = ${userId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createChatForAccount(input: {
  accountId: string;
  name: string;
  userId: string;
}) {
  const created = await withTransaction(async (tx) => {
    const memberRows = await tx`
      select 1
      from account_members
      where account_id = ${input.accountId}::uuid
        and user_id = ${input.userId}::uuid
      limit 1
    `;

    if (memberRows.length === 0) {
      throw new Error("Forbidden");
    }

    const slug = await createUniqueChatSlug(tx, input.accountId, input.name);
    const installations = await tx`
      select id
      from slack_installations
      where account_id = ${input.accountId}::uuid
      order by updated_at desc
      limit 1
    `;
    const slackStatus = installations.length > 0 ? "provisioning" : "disconnected";

    const rows = await tx<Chat[]>`
      insert into chats (account_id, name, slug, created_by_user_id, slack_status)
      values (
        ${input.accountId}::uuid,
        ${input.name},
        ${slug},
        ${input.userId}::uuid,
        ${slackStatus}
      )
      returning *
    `;

    return rows[0];
  });

  if (created.slack_status === "provisioning") {
    await enqueueSlackProvision(
      { chatId: created.id },
      { idempotencyKey: `provision:${created.id}` },
    );
  }

  return created;
}
