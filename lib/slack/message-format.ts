type MessageFormatInput = {
  chatName: string;
  role: "human" | "assistant" | "system" | null;
  origin: "app" | "slack" | "system" | null;
  text: string | null;
  authorDisplayName: string | null;
};

export function formatSlackMirrorMessage(input: MessageFormatInput) {
  if (!input.text) {
    return null;
  }

  const prefix = `[${input.chatName}]`;

  if (input.role === "assistant") {
    return `${prefix} Assistant: ${input.text}`;
  }

  if (input.role === "human" && input.origin === "app") {
    return `${prefix} ${input.authorDisplayName ?? "App User"}: ${input.text}`;
  }

  return `${prefix} ${input.text}`;
}

export function buildSlackThreadRootMessage(chatName: string) {
  return `🧵 ${chatName}\nMessages for this chat are synced in this thread.`;
}
