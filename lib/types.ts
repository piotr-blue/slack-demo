export type SlackStatus = "disconnected" | "provisioning" | "ready" | "error";

export type Account = {
  id: string;
  name: string;
  slug: string;
  created_by_user_id: string;
  created_at: string;
};

export type Chat = {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  created_by_user_id: string;
  slack_status: SlackStatus;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  account_id: string;
  chat_id: string;
  sort_key: number;
  role: "human" | "assistant" | "system";
  origin: "app" | "slack" | "system";
  author_user_id: string | null;
  author_display_name: string | null;
  slack_user_id: string | null;
  text: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
