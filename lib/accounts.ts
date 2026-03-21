import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { getDb, withTransaction } from "@/lib/db";
import { ensureSlug } from "@/lib/slug";
import type { Account } from "@/lib/types";

async function createUniqueAccountSlug(tx: Sql, name: string) {
  const base = ensureSlug(name, "account");
  const candidates = [base, `${base}-${randomUUID().slice(0, 6)}`];

  for (const slug of candidates) {
    const existing = await tx`select id from accounts where slug = ${slug} limit 1`;
    if (existing.length === 0) {
      return slug;
    }
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function listAccountsForUser(userId: string): Promise<Account[]> {
  const db = getDb();
  return db<Account[]>`
    select a.*
    from accounts a
    join account_members am on am.account_id = a.id
    where am.user_id = ${userId}::uuid
    order by a.created_at asc
  `;
}

export async function getAccountBySlugForUser(userId: string, accountSlug: string) {
  const db = getDb();
  const rows = await db<Account[]>`
    select a.*
    from accounts a
    join account_members am on am.account_id = a.id
    where am.user_id = ${userId}::uuid
      and a.slug = ${accountSlug}
    limit 1
  `;

  return rows[0] ?? null;
}

export async function createAccountForUser(input: {
  name: string;
  userId: string;
}) {
  return withTransaction(async (tx) => {
    const slug = await createUniqueAccountSlug(tx, input.name);
    const inserted = await tx<Account[]>`
      insert into accounts (name, slug, created_by_user_id)
      values (${input.name}, ${slug}, ${input.userId}::uuid)
      returning *
    `;
    const account = inserted[0];

    await tx`
      insert into account_members (account_id, user_id, role)
      values (${account.id}::uuid, ${input.userId}::uuid, 'owner')
      on conflict (account_id, user_id) do nothing
    `;

    return account;
  });
}
