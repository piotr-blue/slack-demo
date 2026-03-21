import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
};

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  const user: SessionUser = {
    id: data.user.id,
    email: data.user.email ?? null,
  };

  const db = getDb();
  await db`
    insert into profiles (id, email, display_name)
    values (${user.id}::uuid, ${user.email}, ${user.email?.split("@")[0] ?? "User"})
    on conflict (id) do update set email = excluded.email
  `;

  return user;
});

export async function requireSessionUser() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth");
  }
  return user;
}
