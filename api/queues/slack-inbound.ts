import {
  handleQueueNodeCallback,
  type SlackInboundQueuePayload,
} from "@/lib/queue";
import type { SlackEventEnvelope } from "@/lib/slack/types";
import { processSlackInboundEvent } from "@/lib/slack/inbound";

export default handleQueueNodeCallback<SlackInboundQueuePayload>(
  async (message) => {
    await processSlackInboundEvent(message.eventEnvelope as SlackEventEnvelope);
  },
);
