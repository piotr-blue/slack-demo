import { handleQueueCallback, type SlackInboundQueuePayload } from "@/lib/queue";
import type { SlackEventEnvelope } from "@/lib/slack/types";
import { processSlackInboundEvent } from "@/lib/slack/inbound";

export const runtime = "nodejs";

export const POST = handleQueueCallback<SlackInboundQueuePayload>(async (message) => {
  await processSlackInboundEvent(message.eventEnvelope as SlackEventEnvelope);
});
