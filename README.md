# slack-demo-app

Production-shaped multi-tenant chat demo built with:

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase Auth + Postgres + Realtime Broadcast
- `postgres.js` transactional write paths (`prepare: false`)
- Slack OAuth + Events API + Web API
- Vercel Queues (`slack-inbound`, `slack-outbound`, `slack-provision`)

---

## Architecture summary

### Core product flow

- A signed-in user can belong to multiple accounts (tenants).
- First onboarding flow creates:
  1. account
  2. account membership (`owner`)
  3. default `general` chat
- Each chat has immutable message inserts.
- Every human message creates deterministic assistant reply:
  - `Right, <exact original text>`

### Slack sync model

- Slack connection is per-account.
- Every chat maps to one public Slack channel when provisioning completes.
- App-origin human messages:
  - are inserted immediately in Postgres
  - assistant reply is inserted in same transaction
  - Slack mirror work is queued (never blocks UI)
- Slack-origin human messages:
  - are persisted as `origin = slack`
  - assistant reply is inserted
  - only assistant message is queued back to Slack (prevents loops)
- Bot/subtype Slack events are ignored.
- Inbound event idempotency uses `slack_event_receipts`.
- Outbound retries + throttling use `slack_outbox`, `slack_workspace_throttle`, `slack_channel_throttle`.

### Realtime model

- Message insert trigger uses `realtime.broadcast_changes`.
- Topic format: `room:<chat_id>:messages`.
- Client subscribes to private channel per active chat.
- Authorization enforced via `realtime.messages` RLS policy + helper function.

---

## Repository structure

- `app/` — pages, API routes, queue consumers
- `lib/` — domain logic (db, auth, messages, queue, slack, crypto)
- `supabase/migrations/` — schema + RLS + realtime triggers/policies
- `tests/unit` — deterministic reply / signature / channel-name tests
- `tests/integration` — app message transaction + inbound idempotency tests
- `tests/e2e` — Playwright smoke scenario
- `slack-app-manifest.yaml` — Slack app manifest template
- `vercel.json` — function + queue trigger config

---

## Data model (high level)

Main tables:

- `accounts`
- `account_members`
- `profiles`
- `chats`
- `messages`
- `slack_installations`
- `slack_event_receipts`
- `slack_outbox`
- `slack_workspace_throttle`
- `slack_channel_throttle`

See SQL under `supabase/migrations`.

---

## Environment variables

Use `.env.example` as template.

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

- `DISABLE_QUEUE` (`true` disables queue sends in local/testing)
- `VERCEL_REGION` (defaults to `iad1`)
- `RUN_E2E` (set `true` to enable Playwright smoke)
- `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`

---

## Local setup (exact order)

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Create Supabase project**
   - Enable Email/Password auth in Supabase Auth settings.

3. **Apply migrations**
   - Run the SQL migrations in `supabase/migrations` in order:
     1. `0001_initial_schema.sql`
     2. `0002_rls_and_policies.sql`
     3. `0003_realtime_broadcast.sql`

4. **Create Slack app from manifest**
   - In Slack app settings, create new app from `slack-app-manifest.yaml`.
   - Replace placeholders:
     - redirect URL: `https://<your-app-domain>/api/slack/oauth/callback`
     - events URL: `https://<your-app-domain>/api/slack/events`
   - Install app to workspace.

5. **Configure local env**
   - Copy `.env.example` to `.env.local`.
   - Fill all required values.
   - Generate encryption key:

   ```bash
   openssl rand -base64 32
   ```

6. **Link Vercel project + pull env**

   ```bash
   vercel link
   vercel env pull
   ```

7. **Run app**

   ```bash
   pnpm dev
   ```

---

## Deploy to Vercel

1. Push repository to GitHub.
2. Import repo into Vercel.
3. Add all env vars from `.env.example`.
4. Ensure `vercel.json` is present (queue triggers are declared there).
5. Deploy.
6. Update Slack app URLs to deployed domain:
   - OAuth callback: `/api/slack/oauth/callback`
   - Event request URL: `/api/slack/events`
7. Reinstall Slack app to workspace after URL changes if required by Slack UI.

---

## Slack app configuration checklist

- Bot scopes:
  - `chat:write`
  - `channels:manage`
  - `channels:read`
  - `channels:history`
- Bot event subscriptions:
  - `message.channels`
- Socket Mode:
  - **disabled**
- Public channels:
  - used for this demo

---

## Queue topics / consumers

- `slack-inbound` → `app/api/queues/slack-inbound/route.ts`
- `slack-outbound` → `app/api/queues/slack-outbound/route.ts`
- `slack-provision` → `app/api/queues/slack-provision/route.ts`

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

---

## Testing notes

- Unit + integration tests are fully mocked and do not require real Slack credentials.
- Playwright smoke test exists at `tests/e2e/smoke.spec.ts`.
  - It is gated behind `RUN_E2E=true`.