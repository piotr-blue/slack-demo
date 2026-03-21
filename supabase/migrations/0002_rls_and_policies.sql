alter table profiles enable row level security;
alter table accounts enable row level security;
alter table account_members enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table slack_installations enable row level security;
alter table slack_outbox enable row level security;

create or replace function public.is_account_member(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from account_members am
    where am.account_id = target_account_id
      and am.user_id = auth.uid()
  );
$$;

revoke all on function public.is_account_member(uuid) from public;
grant execute on function public.is_account_member(uuid) to authenticated;

drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self
on profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self
on profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self
on profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists accounts_select_member on accounts;
create policy accounts_select_member
on accounts
for select
to authenticated
using (public.is_account_member(id));

drop policy if exists accounts_insert_creator on accounts;
create policy accounts_insert_creator
on accounts
for insert
to authenticated
with check (created_by_user_id = auth.uid());

drop policy if exists accounts_update_owner on accounts;
create policy accounts_update_owner
on accounts
for update
to authenticated
using (public.is_account_member(id))
with check (public.is_account_member(id));

drop policy if exists account_members_select_member on account_members;
create policy account_members_select_member
on account_members
for select
to authenticated
using (public.is_account_member(account_id));

drop policy if exists account_members_insert_member on account_members;
create policy account_members_insert_member
on account_members
for insert
to authenticated
with check (public.is_account_member(account_id) or user_id = auth.uid());

drop policy if exists chats_select_member on chats;
create policy chats_select_member
on chats
for select
to authenticated
using (public.is_account_member(account_id));

drop policy if exists chats_insert_member on chats;
create policy chats_insert_member
on chats
for insert
to authenticated
with check (
  public.is_account_member(account_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists chats_update_member on chats;
create policy chats_update_member
on chats
for update
to authenticated
using (public.is_account_member(account_id))
with check (public.is_account_member(account_id));

drop policy if exists messages_select_member on messages;
create policy messages_select_member
on messages
for select
to authenticated
using (public.is_account_member(account_id));

drop policy if exists messages_insert_member on messages;
create policy messages_insert_member
on messages
for insert
to authenticated
with check (public.is_account_member(account_id));

drop policy if exists slack_installations_select_member on slack_installations;
create policy slack_installations_select_member
on slack_installations
for select
to authenticated
using (public.is_account_member(account_id));

drop policy if exists slack_installations_insert_member on slack_installations;
create policy slack_installations_insert_member
on slack_installations
for insert
to authenticated
with check (
  public.is_account_member(account_id)
  and connected_by_user_id = auth.uid()
);

drop policy if exists slack_installations_update_member on slack_installations;
create policy slack_installations_update_member
on slack_installations
for update
to authenticated
using (public.is_account_member(account_id))
with check (public.is_account_member(account_id));

drop policy if exists slack_outbox_select_member on slack_outbox;
create policy slack_outbox_select_member
on slack_outbox
for select
to authenticated
using (public.is_account_member(account_id));
