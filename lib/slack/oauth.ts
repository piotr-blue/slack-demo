import { getServerEnv } from "@/lib/env";

type OAuthResponse = {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  access_token?: string;
  scope?: string;
  bot_user_id?: string;
};

export async function exchangeSlackOAuthCode(input: {
  code: string;
  redirectUri: string;
}) {
  const env = getServerEnv();

  const body = new URLSearchParams({
    code: input.code,
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    redirect_uri: input.redirectUri,
  });

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const payload = (await response.json()) as OAuthResponse;
  if (!response.ok || !payload.ok || !payload.access_token || !payload.team?.id) {
    throw new Error(payload.error ?? "Failed Slack OAuth exchange");
  }

  return {
    teamId: payload.team.id,
    teamName: payload.team.name ?? null,
    botToken: payload.access_token,
    botUserId: payload.bot_user_id ?? null,
    scope: payload.scope ?? null,
  };
}
