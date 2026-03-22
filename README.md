# slack-demo-app

Multi-tenant chat app (Next.js + Supabase + Vercel Queues) with **private Slack DM/thread sync**.

## Architecture summary

### Core app model

- A user can belong to multiple accounts (tenants).
- Chats are **user-owned** (`chats.owner_user_id`).
- A user can only see and interact with chats they own.
- Each human message gets deterministic assistant response:
  - `Right, <exact original text>`

### Slack model (v1)

This repo uses:

1. **Workspace installation** (one Slack app install per customer workspace)
2. **User-level linking** (each app user links their Slack identity)
3. **One private DM per linked user** (bot ↔ user)
4. **Multiple chats as threads** in that user DM (`chats.slack_thread_ts`)

It does **not** use “one public channel per chat”.

### Why this is correct for Alice/Bob privacy

- Alice and Bob can be in the same customer workspace.
- Alice links her Slack user → app syncs only Alice-owned chats to Alice’s DM.
- Bob links his Slack user → app syncs only Bob-owned chats to Bob’s DM.
- No workspace-shared public channel is used as primary sync transport.

### Queue/workers

- `slack-inbound`: handles incoming Slack DM events (`message.im`)
- `slack-outbound`: sends mirrored messages to user DM threads
- `slack-provision`: ensures DM channel + root thread exist for a chat

All Slack sync is async via queue (UI path remains non-blocking).

---

## Data model (high level)

Main Slack-related tables:

- `slack_workspace_installations`
- `slack_user_links`
- `slack_event_receipts`
- `slack_outbox`
- `slack_workspace_throttle`
- `slack_channel_throttle`

Key chat fields:

- `chats.owner_user_id`
- `chats.slack_thread_ts`
- `chats.slack_status`

---

## Slack app setup

Use `slack-app-manifest.yaml` and replace:

- OAuth redirect URL: `https://<APP_URL>/api/slack/oauth/callback`
- Events request URL: `https://<APP_URL>/api/slack/events`

Required bot scopes:

- `chat:write`
- `im:read`
- `im:history`
- `im:write`

Required bot event subscription:

- `message.im`

Socket mode is disabled.

---

## Environment variables

Use `.env.example`.

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `APP_URL`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `TOKEN_ENCRYPTION_KEY` (base64 encoded 32-byte key)

Optional:

- `DISABLE_QUEUE`
- `VERCEL_REGION`
- `RUN_E2E`, `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`

---

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create Supabase project and enable Email/Password auth.

3. Apply SQL migrations in order from `supabase/migrations`.

4. Create Slack app from `slack-app-manifest.yaml`, set real URLs, install to workspace.

5. Configure env:

   ```bash
   cp .env.example .env.local
   openssl rand -base64 32
   ```

6. Run app:

   ```bash
   pnpm dev
   ```

---

## User flows

### Workspace connect (owner)

Settings → **Connect workspace to Slack**  
This stores/updates `slack_workspace_installations`.

### User link (individual user)

Settings → **Link my Slack user**  
This stores `slack_user_links` and opens/records DM channel for that user.

### Message sync

- App-origin messages:
  - write app human + assistant rows
  - enqueue outbox
  - worker ensures DM + root thread, then posts thread messages
- Slack-origin DM messages:
  - accept only `message.im`
  - resolve linked user by team/user
  - map by thread or active chat marker
  - write human + assistant rows
  - enqueue assistant mirror back to same DM/thread

---

## Scripts

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```