import { handleCallback } from "@vercel/queue";
import { enqueueSlackOutbound, type SlackOutboundQueuePayload } from "@/lib/queue";
import { dispatchSlackOutbox } from "@/lib/slack/outbox";

export const runtime = "nodejs";

export const POST = handleCallback<SlackOutboundQueuePayload>(async (message) => {
  const result = await dispatchSlackOutbox(message.outboxId);
  if (result.status === "retry") {
    await enqueueSlackOutbound(
      { outboxId: message.outboxId },
      {
        delaySeconds: result.delaySeconds,
        idempotencyKey: `outbox:${message.outboxId}:${Date.now()}`,
      },
    );
  }
});
