import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSlackSignatureBaseString,
  verifySlackSignature,
} from "@/lib/slack/signature";

describe("verifySlackSignature", () => {
  const signingSecret = "secret";
  const timestamp = "1700000000";
  const rawBody = JSON.stringify({ type: "event_callback" });

  function sign() {
    const base = buildSlackSignatureBaseString(timestamp, rawBody);
    const digest = crypto
      .createHmac("sha256", signingSecret)
      .update(base)
      .digest("hex");
    return `v0=${digest}`;
  }

  it("accepts valid Slack signature", () => {
    const now = new Date(Number(timestamp) * 1000);
    expect(
      verifySlackSignature({
        signingSecret,
        rawBody,
        timestamp,
        signature: sign(),
        now,
      }),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    const now = new Date(Number(timestamp) * 1000);
    expect(
      verifySlackSignature({
        signingSecret,
        rawBody,
        timestamp,
        signature: "v0=wrong",
        now,
      }),
    ).toBe(false);
  });

  it("rejects stale timestamp", () => {
    const now = new Date((Number(timestamp) + 9999) * 1000);
    expect(
      verifySlackSignature({
        signingSecret,
        rawBody,
        timestamp,
        signature: sign(),
        now,
      }),
    ).toBe(false);
  });
});
