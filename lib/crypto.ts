import crypto from "node:crypto";
import { getServerEnv } from "@/lib/env";

const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const { TOKEN_ENCRYPTION_KEY } = getServerEnv();
  const decoded = Buffer.from(TOKEN_ENCRYPTION_KEY, "base64");
  if (decoded.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key");
  }
  return decoded;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [version, ivB64, authTagB64, payloadB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !authTagB64 || !payloadB64) {
    throw new Error("Invalid encrypted secret payload");
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payloadB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
