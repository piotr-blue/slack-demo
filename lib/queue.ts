import { QueueClient } from "@vercel/queue";

export const QUEUE_TOPICS = {
  slackInbound: "slack-inbound",
  slackOutbound: "slack-outbound",
  slackProvision: "slack-provision",
} as const;

export type SlackInboundQueuePayload = {
  eventEnvelope: Record<string, unknown>;
};

export type SlackOutboundQueuePayload = {
  outboxId: string;
};

export type SlackProvisionQueuePayload = {
  chatId: string;
};

const queueClient = new QueueClient({
  region: process.env.VERCEL_REGION ?? "iad1",
});

export const handleQueueCallback = queueClient.handleCallback;

async function sendMessage<T>(
  topic: string,
  payload: T,
  options?: {
    idempotencyKey?: string;
    delaySeconds?: number;
  },
) {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_QUEUE === "true") {
    return { messageId: `${topic}-noop` };
  }

  return queueClient.send(topic, payload, options);
}

export function enqueueSlackInbound(
  payload: SlackInboundQueuePayload,
  options?: { idempotencyKey?: string; delaySeconds?: number },
) {
  return sendMessage(QUEUE_TOPICS.slackInbound, payload, options);
}

export function enqueueSlackOutbound(
  payload: SlackOutboundQueuePayload,
  options?: { idempotencyKey?: string; delaySeconds?: number },
) {
  return sendMessage(QUEUE_TOPICS.slackOutbound, payload, options);
}

export function enqueueSlackProvision(
  payload: SlackProvisionQueuePayload,
  options?: { idempotencyKey?: string; delaySeconds?: number },
) {
  return sendMessage(QUEUE_TOPICS.slackProvision, payload, options);
}
