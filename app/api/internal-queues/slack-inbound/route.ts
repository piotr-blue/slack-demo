import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalQueueSecret } from "@/lib/queue-internal";
import type { SlackEventEnvelope } from "@/lib/slack/types";
import { processSlackInboundEvent } from "@/lib/slack/inbound";

const schema = z.object({
  message: z.object({
    eventEnvelope: z.record(z.string(), z.unknown()),
  }),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertInternalQueueSecret(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await processSlackInboundEvent(parsed.data.message.eventEnvelope as SlackEventEnvelope);
  return NextResponse.json({ ok: true });
}
