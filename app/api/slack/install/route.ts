import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { createSlackOAuthState } from "@/lib/slack/state";

const querySchema = z.object({
  accountId: z.string().uuid(),
});

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) {
    return auth.response!;
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountId: url.searchParams.get("accountId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
  }

  const db = getDb();
  const membership = await db`
    select 1
    from account_members
    where account_id = ${parsed.data.accountId}::uuid
      and user_id = ${auth.user.id}::uuid
    limit 1
  `;
  if (membership.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const env = getServerEnv();
  const redirectUri = `${env.APP_URL}/api/slack/oauth/callback`;
  const { state, nonce } = createSlackOAuthState(parsed.data.accountId);
  const slackAuthorize = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthorize.searchParams.set("client_id", env.SLACK_CLIENT_ID);
  slackAuthorize.searchParams.set(
    "scope",
    "chat:write,channels:manage,channels:read,channels:history",
  );
  slackAuthorize.searchParams.set("redirect_uri", redirectUri);
  slackAuthorize.searchParams.set("state", state);

  const response = NextResponse.redirect(slackAuthorize);
  response.cookies.set("slack_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
