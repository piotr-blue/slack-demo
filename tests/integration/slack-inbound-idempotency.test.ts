import { beforeEach, describe, expect, it, vi } from "vitest";

const withTransactionMock = vi.fn();
const enqueueSlackOutboundMock = vi.fn();

vi.mock("@/lib/db", () => ({
  withTransaction: withTransactionMock,
}));

vi.mock("@/lib/queue", () => ({
  enqueueSlackOutbound: enqueueSlackOutboundMock,
}));

describe("processSlackInboundEvent idempotency", () => {
  beforeEach(() => {
    withTransactionMock.mockReset();
    enqueueSlackOutboundMock.mockReset().mockResolvedValue({ messageId: "queue-msg" });
  });

  it("processes first event and ignores duplicate event_id", async () => {
    let delivery = 0;

    withTransactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      delivery += 1;
      const tx = (async (strings: TemplateStringsArray) => {
        const sql = strings.join(" ");

        if (sql.includes("insert into slack_event_receipts")) {
          if (delivery === 1) {
            return [{ event_id: "evt-1" }];
          }
          return [];
        }
        if (sql.includes("from chats c")) {
          return [
            {
              chat_id: "chat-1",
              account_id: "acc-1",
              installation_id: "inst-1",
              bot_user_id: "U_BOT",
              channel_id: "C123",
            },
          ];
        }
        if (sql.includes("insert into messages") && sql.includes("'human'")) {
          return [{ id: "human-1", text: "hello from slack" }];
        }
        if (sql.includes("insert into messages") && sql.includes("'assistant'")) {
          return [{ id: "assistant-1" }];
        }
        if (sql.includes("insert into slack_outbox")) {
          return [{ id: "outbox-1" }];
        }
        return [];
      }) as any;
      tx.json = (value: unknown) => value;
      return callback(tx);
    });

    const { processSlackInboundEvent } = await import("@/lib/slack/inbound");
    const envelope = {
      type: "event_callback",
      team_id: "T1",
      event_id: "evt-1",
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "hello from slack",
      },
    } as const;

    const first = await processSlackInboundEvent(envelope);
    const second = await processSlackInboundEvent(envelope);

    expect(first.ignored).toBe(false);
    expect(second.ignored).toBe(true);
    expect(enqueueSlackOutboundMock).toHaveBeenCalledTimes(1);
  });
});
