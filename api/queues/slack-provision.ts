import {
  enqueueSlackProvision,
  handleQueueNodeCallback,
  type SlackProvisionQueuePayload,
} from "@/lib/queue";
import { provisionSlackChannelForChat } from "@/lib/slack/provision";

export default handleQueueNodeCallback<SlackProvisionQueuePayload>(
  async (message) => {
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
  },
);
