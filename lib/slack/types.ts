export type SlackInstallation = {
  id: string;
  account_id: string;
  team_id: string;
  team_name: string | null;
  bot_token_encrypted: string;
  bot_user_id: string | null;
  scope: string | null;
  connected_by_user_id: string;
  installed_at: string;
  updated_at: string;
};

export type SlackOutboxStatus = "pending" | "sent" | "failed" | "retrying";
export type SlackOutboxKind = "mirror_message" | "provision_chat" | "setup_notice";

export type SlackOutboxRow = {
  id: string;
  account_id: string;
  chat_id: string;
  message_id: string | null;
  installation_id: string;
  channel_id: string;
  kind: SlackOutboxKind;
  status: SlackOutboxStatus;
  attempts: number;
  next_attempt_at: string;
  external_message_ts: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SlackEventEnvelope = {
  token?: string;
  team_id?: string;
  type: string;
  event_id?: string;
  challenge?: string;
  event_time?: number;
  event?: {
    type?: string;
    channel?: string;
    user?: string;
    text?: string;
    subtype?: string;
    bot_id?: string;
    [key: string]: unknown;
  };
};
