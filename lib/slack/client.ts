import { WebClient } from "@slack/web-api";

export function createSlackClient(botToken: string) {
  return new WebClient(botToken);
}
