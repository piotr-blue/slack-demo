import { describe, expect, it } from "vitest";
import { buildSlackChannelName } from "@/lib/slack/channel-name";

describe("buildSlackChannelName", () => {
  it("builds deterministic, lowercase names", () => {
    expect(
      buildSlackChannelName({ accountSlug: "Acme-Team", chatSlug: "General" }),
    ).toBe("acme-team-general");
  });

  it("strips unsupported characters", () => {
    expect(
      buildSlackChannelName({ accountSlug: "Acme*&^", chatSlug: "Sales $$$" }),
    ).toBe("acme-sales");
  });

  it("enforces max length with stable hash suffix", () => {
    const value = buildSlackChannelName({
      accountSlug: "a".repeat(60),
      chatSlug: "b".repeat(60),
    });
    expect(value.length).toBeLessThanOrEqual(80);
    expect(value).toMatch(/[a-f0-9]{8}$/);
  });
});
