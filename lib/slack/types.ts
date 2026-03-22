export type SlackWorkspaceInstallation = {
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

export type SlackUserLink = {
  id: string;
  account_id: string;
  app_user_id: string;
  slack_team_id: string;
  slack_user_id: string;
  slack_dm_channel_id: string | null;
  active_chat_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SlackOutboxStatus = "pending" | "sent" | "failed" | "retrying";
export type SlackOutboxKind = "mirror_message" | "provision_chat" | "setup_notice";

export type SlackOutboxRow = {
  id: string;
  account_id: string;
  chat_id: string;
  message_id: string | null;
  installation_id: string | null;
  slack_user_link_id: string | null;
  channel_id: string | null;
  thread_ts: string | null;
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
    channel_type?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    subtype?: string;
    bot_id?: string;
    [key: string]: unknown;
  };
};
