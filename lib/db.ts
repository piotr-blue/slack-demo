import postgres from "postgres";
import { getServerEnv } from "@/lib/env";

let sqlClient: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (sqlClient) {
    return sqlClient;
  }

  const env = getServerEnv();
  sqlClient = postgres(env.SUPABASE_DB_URL, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return sqlClient;
}

export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  const db: any = getDb();
  return db.begin(async (tx: any) => callback(tx)) as Promise<T>;
}
