import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalQueueSecret } from "@/lib/queue-internal";
import { enqueueSlackProvision } from "@/lib/queue";
import { provisionSlackChannelForChat } from "@/lib/slack/provision";

const schema = z.object({
  message: z.object({
    chatId: z.string().uuid(),
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

  try {
    await provisionSlackChannelForChat(parsed.data.message.chatId);
  } catch {
    await enqueueSlackProvision(
      { chatId: parsed.data.message.chatId },
      {
        delaySeconds: 30,
        idempotencyKey: `provision:${parsed.data.message.chatId}:${Date.now()}`,
      },
    );
  }

  return NextResponse.json({ ok: true });
}
