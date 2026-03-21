create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_member_role') then
    create type account_member_role as enum ('owner');
  end if;

  if not exists (select 1 from pg_type where typname = 'chat_slack_status') then
    create type chat_slack_status as enum ('disconnected', 'provisioning', 'ready', 'error');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_role') then
    create type message_role as enum ('human', 'assistant', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_origin') then
    create type message_origin as enum ('app', 'slack', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'slack_outbox_kind') then
    create type slack_outbox_kind as enum ('mirror_message', 'provision_chat', 'setup_notice');
  end if;

  if not exists (select 1 from pg_type where typname = 'slack_outbox_status') then
    create type slack_outbox_status as enum ('pending', 'sent', 'failed', 'retrying');
  end if;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists account_members (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role account_member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  slug text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  slack_status chat_slack_status not null default 'disconnected',
  slack_channel_id text,
  slack_channel_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, slug)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  sort_key bigint generated always as identity,
  role message_role not null,
  origin message_origin not null,
  author_user_id uuid references auth.users(id) on delete set null,
  author_display_name text,
  slack_user_id text,
  text text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists slack_installations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  team_id text not null,
  team_name text,
  bot_token_encrypted text not null,
  bot_user_id text,
  scope text,
  connected_by_user_id uuid not null references auth.users(id) on delete restrict,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, team_id)
);

create table if not exists slack_event_receipts (
  event_id text primary key,
  team_id text not null,
  event_type text not null,
  received_at timestamptz not null default now()
);

create table if not exists slack_outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  installation_id uuid not null references slack_installations(id) on delete cascade,
  channel_id text not null,
  kind slack_outbox_kind not null,
  status slack_outbox_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  external_message_ts text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists slack_workspace_throttle (
  installation_id uuid primary key references slack_installations(id) on delete cascade,
  next_allowed_at timestamptz not null
);

create table if not exists slack_channel_throttle (
  installation_id uuid not null references slack_installations(id) on delete cascade,
  channel_id text not null,
  next_allowed_at timestamptz not null,
  primary key (installation_id, channel_id)
);

create index if not exists idx_account_members_user_account
  on account_members (user_id, account_id);

create index if not exists idx_chats_account_created_desc
  on chats (account_id, created_at desc);

create index if not exists idx_chats_slack_channel_id
  on chats (slack_channel_id);

create index if not exists idx_messages_chat_sort_desc
  on messages (chat_id, sort_key desc);

create index if not exists idx_messages_account_created_desc
  on messages (account_id, created_at desc);

create index if not exists idx_slack_outbox_status_next_attempt
  on slack_outbox (status, next_attempt_at);

create index if not exists idx_slack_outbox_installation_channel_created
  on slack_outbox (installation_id, channel_id, created_at);

create index if not exists idx_slack_installations_account
  on slack_installations (account_id);

create unique index if not exists idx_slack_outbox_message_kind_unique
  on slack_outbox (message_id, kind)
  where message_id is not null and kind = 'mirror_message';

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chats_set_updated_at on chats;
create trigger chats_set_updated_at
before update on chats
for each row
execute function update_updated_at_column();

drop trigger if exists slack_installations_set_updated_at on slack_installations;
create trigger slack_installations_set_updated_at
before update on slack_installations
for each row
execute function update_updated_at_column();

drop trigger if exists slack_outbox_set_updated_at on slack_outbox;
create trigger slack_outbox_set_updated_at
before update on slack_outbox
for each row
execute function update_updated_at_column();
