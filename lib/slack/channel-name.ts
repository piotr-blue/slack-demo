import crypto from "node:crypto";
import { ensureSlug } from "@/lib/slug";

const MAX_CHANNEL_NAME_LENGTH = 80;

function sanitizeSlackName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function shortHash(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
}

export function buildSlackChannelName(input: {
  accountSlug: string;
  chatSlug: string;
}) {
  const account = sanitizeSlackName(ensureSlug(input.accountSlug, "account"));
  const chat = sanitizeSlackName(ensureSlug(input.chatSlug, "chat"));
  const base = sanitizeSlackName(`${account}-${chat}`);

  if (base.length <= MAX_CHANNEL_NAME_LENGTH) {
    return base;
  }

  const hash = shortHash(base);
  const suffix = `-${hash}`;
  const trimmed = base.slice(0, MAX_CHANNEL_NAME_LENGTH - suffix.length);
  return `${trimmed}${suffix}`;
}
