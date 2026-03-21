import { describe, expect, it } from "vitest";
import { buildAssistantReply } from "@/lib/reply";

describe("buildAssistantReply", () => {
  it("builds deterministic response using exact original text", () => {
    expect(buildAssistantReply("hello")).toBe("Right, hello");
    expect(buildAssistantReply("  hello  ")).toBe("Right,   hello  ");
    expect(buildAssistantReply("")).toBe("Right, ");
  });
});
