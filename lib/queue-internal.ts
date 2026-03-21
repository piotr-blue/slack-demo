import { getServerEnv } from "@/lib/env";

export function assertInternalQueueSecret(request: Request) {
  const secret = request.headers.get("x-queue-internal-secret");
  const expected = getServerEnv().TOKEN_ENCRYPTION_KEY;
  if (!secret || secret !== expected) {
    throw new Error("Unauthorized queue forward");
  }
}
