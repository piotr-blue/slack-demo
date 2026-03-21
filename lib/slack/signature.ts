import crypto from "node:crypto";

const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

export function buildSlackSignatureBaseString(
  timestamp: string,
  rawBody: string,
) {
  return `v0:${timestamp}:${rawBody}`;
}

export function verifySlackSignature(input: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: Date;
}) {
  const { signingSecret, rawBody, timestamp, signature } = input;
  if (!timestamp || !signature) {
    return false;
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampNumber) > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const base = buildSlackSignatureBaseString(timestamp, rawBody);
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const expected = `v0=${digest}`;

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}
