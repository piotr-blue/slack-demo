import crypto from "node:crypto";
import { getServerEnv } from "@/lib/env";

const MAX_AGE_MS = 10 * 60 * 1000;

export type SlackOAuthStateIntent = "workspace_install" | "user_link";

export type SlackOAuthStatePayload = {
  accountId: string;
  intent: SlackOAuthStateIntent;
  nonce: string;
  issuedAt: number;
};

function getStateSecret() {
  return getServerEnv().TOKEN_ENCRYPTION_KEY;
}

function signStatePayload(payloadBase64: string) {
  return crypto.createHmac("sha256", getStateSecret()).update(payloadBase64).digest("hex");
}

export function createSlackOAuthState(input: {
  accountId: string;
  intent: SlackOAuthStateIntent;
}) {
  const payload: SlackOAuthStatePayload = {
    accountId: input.accountId,
    intent: input.intent,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now(),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signStatePayload(payloadBase64);
  return {
    state: `${payloadBase64}.${signature}`,
    nonce: payload.nonce,
    payload,
  };
}

export function verifySlackOAuthState(state: string): SlackOAuthStatePayload {
  const [payloadBase64, signature] = state.split(".");
  if (!payloadBase64 || !signature) {
    throw new Error("Invalid Slack OAuth state");
  }

  const expected = signStatePayload(payloadBase64);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    throw new Error("Invalid Slack OAuth state signature");
  }
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid Slack OAuth state signature");
  }

  const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as SlackOAuthStatePayload;
  if (!payload.intent) {
    payload.intent = "workspace_install";
  }
  if (Date.now() - payload.issuedAt > MAX_AGE_MS) {
    throw new Error("Slack OAuth state expired");
  }
  return payload;
}
