import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack/signature";
import type { SlackEventEnvelope } from "@/lib/slack/types";
import { enqueueSlackInbound } from "@/lib/queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  const env = getServerEnv();
  const isValid = verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    rawBody,
    timestamp,
    signature,
  });
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as SlackEventEnvelope;

  if (payload.type === "url_verification" && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  await enqueueSlackInbound(
    { eventEnvelope: payload as Record<string, unknown> },
    {
      idempotencyKey: payload.event_id ? `inbound:${payload.event_id}` : undefined,
    },
  );

  return NextResponse.json({ ok: true });
}
