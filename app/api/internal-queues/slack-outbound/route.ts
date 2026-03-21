import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalQueueSecret } from "@/lib/queue-internal";
import { enqueueSlackOutbound } from "@/lib/queue";
import { dispatchSlackOutbox } from "@/lib/slack/outbox";

const schema = z.object({
  message: z.object({
    outboxId: z.string().uuid(),
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

  const result = await dispatchSlackOutbox(parsed.data.message.outboxId);
  if (result.status === "retry") {
    await enqueueSlackOutbound(
      { outboxId: parsed.data.message.outboxId },
      {
        delaySeconds: result.delaySeconds,
        idempotencyKey: `outbox:${parsed.data.message.outboxId}:${Date.now()}`,
      },
    );
  }

  return NextResponse.json({ ok: true });
}
