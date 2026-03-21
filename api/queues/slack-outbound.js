const { QueueClient } = require("@vercel/queue");

const queueClient = new QueueClient({
  region: process.env.VERCEL_REGION || "iad1",
});

async function forwardToInternalQueue(routeName, message) {
  const baseUrl = (
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Missing APP_URL or VERCEL_URL for queue forwarding");
  }

  const response = await fetch(`${baseUrl}/api/internal-queues/${routeName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-queue-internal-secret": process.env.TOKEN_ENCRYPTION_KEY || "",
    },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Internal queue route failed (${response.status}): ${body}`);
  }
}

module.exports = queueClient.handleNodeCallback(async (message) => {
  await forwardToInternalQueue("slack-outbound", message);
});
