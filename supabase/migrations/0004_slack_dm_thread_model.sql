do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'slack_installations'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'slack_workspace_installations'
  ) then
    alter table slack_installations rename to slack_workspace_installations;
  end if;
end $$;

do $$
begin
  if to_regclass('public.idx_slack_installations_account') is not null
     and to_regclass('public.idx_slack_workspace_installations_account') is null then
    alter index idx_slack_installations_account rename to idx_slack_workspace_installations_account;
  end if;
exception
  when duplicate_table then
    null;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'slack_workspace_installations'
      and t.tgname = 'slack_installations_set_updated_at'
  ) then
    alter trigger slack_installations_set_updated_at
      on slack_workspace_installations
      rename to slack_workspace_installations_set_updated_at;
  end if;
end $$;

create table if not exists slack_user_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  slack_team_id text not null,
  slack_user_id text not null,
  slack_dm_channel_id text,
  active_chat_id uuid references chats(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, app_user_id, slack_team_id),
  unique (account_id, slack_team_id, slack_user_id)
);

alter table chats
  add column if not exists owner_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists slack_thread_ts text,
  add column if not exists slack_last_error text;

update chats
set owner_user_id = created_by_user_id
where owner_user_id is null;

alter table chats
  alter column owner_user_id set not null;

alter table slack_outbox
  add column if not exists slack_user_link_id uuid references slack_user_links(id) on delete cascade,
  add column if not exists thread_ts text;

alter table slack_outbox
  alter column installation_id drop not null,
  alter column channel_id drop not null;

update slack_outbox so
set thread_ts = c.slack_thread_ts
from chats c
where so.chat_id = c.id
  and so.thread_ts is null;

create index if not exists idx_chats_account_owner_created_desc
  on chats (account_id, owner_user_id, created_at desc);

create index if not exists idx_chats_owner_user_id
  on chats (owner_user_id);

create index if not exists idx_chats_owner_thread_ts
  on chats (owner_user_id, slack_thread_ts)
  where slack_thread_ts is not null;

create index if not exists idx_slack_user_links_account_user
  on slack_user_links (account_id, app_user_id);

create index if not exists idx_slack_user_links_team_user
  on slack_user_links (slack_team_id, slack_user_id);

create index if not exists idx_slack_user_links_active_chat
  on slack_user_links (active_chat_id)
  where active_chat_id is not null;

create index if not exists idx_slack_outbox_user_link_status_next
  on slack_outbox (slack_user_link_id, status, next_attempt_at);

drop trigger if exists slack_user_links_set_updated_at on slack_user_links;
create trigger slack_user_links_set_updated_at
before update on slack_user_links
for each row
execute function update_updated_at_column();
