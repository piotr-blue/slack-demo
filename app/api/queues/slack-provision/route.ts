import {
  enqueueSlackProvision,
  handleQueueCallback,
  type SlackProvisionQueuePayload,
} from "@/lib/queue";
import { provisionSlackChannelForChat } from "@/lib/slack/provision";

export const runtime = "nodejs";

export const POST = handleQueueCallback<SlackProvisionQueuePayload>(async (message) => {
  try {
    await provisionSlackChannelForChat(message.chatId);
  } catch {
    await enqueueSlackProvision(
      { chatId: message.chatId },
      {
        delaySeconds: 30,
        idempotencyKey: `provision:${message.chatId}:${Date.now()}`,
      },
    );
  }
});
