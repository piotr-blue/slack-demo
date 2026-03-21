import { handleCallback } from "@vercel/queue";
import type { SlackInboundQueuePayload } from "@/lib/queue";
import type { SlackEventEnvelope } from "@/lib/slack/types";
import { processSlackInboundEvent } from "@/lib/slack/inbound";

export const runtime = "nodejs";

export const POST = handleCallback<SlackInboundQueuePayload>(async (message) => {
  await processSlackInboundEvent(message.eventEnvelope as SlackEventEnvelope);
});
