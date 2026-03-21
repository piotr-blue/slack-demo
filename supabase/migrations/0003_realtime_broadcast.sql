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
    join account_members am on am.account_id = c.account_id
    where p.prefix = 'room'
      and p.suffix = 'messages'
      and am.user_id = auth.uid()
  );
$$;

revoke all on function public.can_subscribe_chat_topic(text) from public;
grant execute on function public.can_subscribe_chat_topic(text) to authenticated;

drop policy if exists "chat members can receive realtime broadcasts" on realtime.messages;
create policy "chat members can receive realtime broadcasts"
on realtime.messages
for select
to authenticated
using (public.can_subscribe_chat_topic(realtime.topic()));

create or replace function public.broadcast_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'room:' || new.chat_id::text || ':messages',
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    null
  );
  return new;
end;
$$;

drop trigger if exists messages_realtime_broadcast_insert on messages;
create trigger messages_realtime_broadcast_insert
after insert on messages
for each row
execute function public.broadcast_message_insert();
