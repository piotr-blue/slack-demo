import { beforeEach, describe, expect, it, vi } from "vitest";

const withTransactionMock = vi.fn();
const enqueueSlackOutboundMock = vi.fn();

vi.mock("@/lib/db", () => ({
  withTransaction: withTransactionMock,
  getDb: vi.fn(),
}));

vi.mock("@/lib/queue", () => ({
  enqueueSlackOutbound: enqueueSlackOutboundMock,
}));

describe("createAppMessageFlow", () => {
  beforeEach(() => {
    withTransactionMock.mockReset();
    enqueueSlackOutboundMock.mockReset().mockResolvedValue({ messageId: "queue-msg" });
  });

  it("inserts human and assistant messages transactionally and enqueues both outbox rows", async () => {
    withTransactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      let step = 0;
      const tx = (async (strings: TemplateStringsArray) => {
        const sql = strings.join(" ");
        step += 1;
        if (sql.includes("from chats c")) {
          return [
            {
              account_id: "acc-1",
              slack_status: "ready",
              slack_channel_id: "C123",
              installation_id: "inst-1",
              display_name: "Alice",
            },
          ];
        }
        if (sql.includes("insert into messages") && sql.includes("'human'")) {
          return [{ id: "msg-human", text: "hello" }];
        }
        if (sql.includes("insert into messages") && sql.includes("'assistant'")) {
          return [{ id: "msg-assistant", text: "Right, hello" }];
        }
        if (sql.includes("insert into slack_outbox")) {
          return [{ id: "outbox-1" }, { id: "outbox-2" }];
        }
        throw new Error(`Unexpected SQL step ${step}: ${sql}`);
      }) as any;
      tx.json = (value: unknown) => value;

      return callback(tx);
    });

    const { createAppMessageFlow } = await import("@/lib/messages");
    const result = await createAppMessageFlow({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });

    expect(result.humanMessage.id).toBe("msg-human");
    expect(result.assistantMessage.id).toBe("msg-assistant");
    expect(result.outboxIds).toEqual(["outbox-1", "outbox-2"]);
    expect(enqueueSlackOutboundMock).toHaveBeenCalledTimes(2);
  });

  it("does not enqueue outbox when chat is not Slack-ready", async () => {
    withTransactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const tx = (async (strings: TemplateStringsArray) => {
        const sql = strings.join(" ");
        if (sql.includes("from chats c")) {
          return [
            {
              account_id: "acc-1",
              slack_status: "disconnected",
              slack_channel_id: null,
              installation_id: null,
              display_name: "Alice",
            },
          ];
        }
        if (sql.includes("insert into messages") && sql.includes("'human'")) {
          return [{ id: "msg-human", text: "hello" }];
        }
        if (sql.includes("insert into messages") && sql.includes("'assistant'")) {
          return [{ id: "msg-assistant", text: "Right, hello" }];
        }
        if (sql.includes("insert into slack_outbox")) {
          return [];
        }
        return [];
      }) as any;
      tx.json = (value: unknown) => value;

      return callback(tx);
    });

    const { createAppMessageFlow } = await import("@/lib/messages");
    const result = await createAppMessageFlow({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });

    expect(result.outboxIds).toEqual([]);
    expect(enqueueSlackOutboundMock).not.toHaveBeenCalled();
  });
});
