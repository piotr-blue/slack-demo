import { describe, expect, it } from "vitest";
import {
  buildSlackThreadRootMessage,
  formatSlackMirrorMessage,
} from "@/lib/slack/message-format";

describe("formatSlackMirrorMessage", () => {
  it("formats app human messages with chat prefix and author", () => {
    expect(
      formatSlackMirrorMessage({
        chatName: "general",
        role: "human",
        origin: "app",
        text: "hello",
        authorDisplayName: "Alice",
      }),
    ).toBe("[general] Alice: hello");
  });

  it("formats assistant replies with chat prefix", () => {
    expect(
      formatSlackMirrorMessage({
        chatName: "support",
        role: "assistant",
        origin: "system",
        text: "Right, hello",
        authorDisplayName: null,
      }),
    ).toBe("[support] Assistant: Right, hello");
  });

  it("returns null for missing text", () => {
    expect(
      formatSlackMirrorMessage({
        chatName: "general",
        role: "assistant",
        origin: "system",
        text: null,
        authorDisplayName: null,
      }),
    ).toBeNull();
  });
});

describe("buildSlackThreadRootMessage", () => {
  it("creates deterministic thread root text", () => {
    expect(buildSlackThreadRootMessage("general")).toContain("🧵 general");
  });
});
