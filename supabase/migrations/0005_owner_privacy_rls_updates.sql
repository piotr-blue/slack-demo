alter table if exists slack_workspace_installations enable row level security;
alter table if exists slack_user_links enable row level security;

drop policy if exists chats_select_member on chats;
drop policy if exists chats_insert_member on chats;
drop policy if exists chats_update_member on chats;

create policy chats_select_owner
on chats
for select
to authenticated
using (
  owner_user_id = auth.uid()
  and public.is_account_member(account_id)
);

create policy chats_insert_owner
on chats
for insert
to authenticated
with check (
  public.is_account_member(account_id)
  and created_by_user_id = auth.uid()
  and owner_user_id = auth.uid()
);

create policy chats_update_owner
on chats
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists messages_select_member on messages;
drop policy if exists messages_insert_member on messages;

create policy messages_select_owner
on messages
for select
to authenticated
using (
  exists (
    select 1
    from chats c
    where c.id = messages.chat_id
      and c.owner_user_id = auth.uid()
  )
);

create policy messages_insert_owner
on messages
for insert
to authenticated
with check (
  exists (
    select 1
    from chats c
    where c.id = messages.chat_id
      and c.owner_user_id = auth.uid()
  )
);

drop policy if exists slack_workspace_installations_select_member on slack_workspace_installations;
drop policy if exists slack_workspace_installations_insert_owner on slack_workspace_installations;
drop policy if exists slack_workspace_installations_update_owner on slack_workspace_installations;
drop policy if exists slack_installations_select_member on slack_workspace_installations;
drop policy if exists slack_installations_insert_member on slack_workspace_installations;
drop policy if exists slack_installations_update_member on slack_workspace_installations;

create policy slack_workspace_installations_select_member
on slack_workspace_installations
for select
to authenticated
using (public.is_account_member(account_id));

create policy slack_workspace_installations_insert_owner
on slack_workspace_installations
for insert
to authenticated
with check (
  connected_by_user_id = auth.uid()
  and exists (
    select 1
    from account_members am
    where am.account_id = slack_workspace_installations.account_id
      and am.user_id = auth.uid()
      and am.role = 'owner'
  )
);

create policy slack_workspace_installations_update_owner
on slack_workspace_installations
for update
to authenticated
using (
  exists (
    select 1
    from account_members am
    where am.account_id = slack_workspace_installations.account_id
      and am.user_id = auth.uid()
      and am.role = 'owner'
  )
)
with check (
  exists (
    select 1
    from account_members am
    where am.account_id = slack_workspace_installations.account_id
      and am.user_id = auth.uid()
      and am.role = 'owner'
  )
);

drop policy if exists slack_user_links_select_self on slack_user_links;
drop policy if exists slack_user_links_insert_self on slack_user_links;
drop policy if exists slack_user_links_update_self on slack_user_links;

create policy slack_user_links_select_self
on slack_user_links
for select
to authenticated
using (
  app_user_id = auth.uid()
  and public.is_account_member(account_id)
);

create policy slack_user_links_insert_self
on slack_user_links
for insert
to authenticated
with check (
  app_user_id = auth.uid()
  and public.is_account_member(account_id)
);

create policy slack_user_links_update_self
on slack_user_links
for update
to authenticated
using (app_user_id = auth.uid())
with check (app_user_id = auth.uid());

drop policy if exists slack_outbox_select_member on slack_outbox;
drop policy if exists slack_outbox_select_owner on slack_outbox;

create policy slack_outbox_select_owner
on slack_outbox
for select
to authenticated
using (
  exists (
    select 1
    from chats c
    where c.id = slack_outbox.chat_id
      and c.owner_user_id = auth.uid()
  )
);

create or replace function public.can_subscribe_chat_topic(topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with parsed as (
    select
      split_part(topic, ':', 1) as prefix,
      nullif(split_part(topic, ':', 2), '')::uuid as chat_id,
      split_part(topic, ':', 3) as suffix
  )
  select exists (
    select 1
    from parsed p
    join chats c on c.id = p.chat_id
    where p.prefix = 'room'
      and p.suffix = 'messages'
      and c.owner_user_id = auth.uid()
  );
$$;
