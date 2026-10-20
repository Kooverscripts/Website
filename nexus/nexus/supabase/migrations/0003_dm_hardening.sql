-- NEXUS 0003: bloqueio em DMs, preferências de amizade e rate limit

drop policy if exists dm_insert on direct_messages;
create policy dm_insert on direct_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and is_dm_member(conversation_id, auth.uid())
    and not exists (
      select 1 from direct_conversation_members m
      where m.conversation_id = direct_messages.conversation_id
        and m.user_id <> auth.uid()
        and is_blocked_between(auth.uid(), m.user_id))
  );

drop policy if exists friends_insert on friendships;
create policy friends_insert on friendships for insert to authenticated
  with check (
    requester_id = auth.uid() and status = 'pending'
    and not is_blocked_between(requester_id, addressee_id)
    and coalesce((select who_can_friend from user_settings where user_id = addressee_id), 'everyone') <> 'nobody'
  );

create or replace function rate_limit_dm() returns trigger
language plpgsql as $$
begin
  if (select count(*) from direct_messages
      where author_id = new.author_id and created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'rate limit';
  end if;
  return new;
end $$;
drop trigger if exists dm_rate_limit on direct_messages;
create trigger dm_rate_limit before insert on direct_messages
  for each row execute function rate_limit_dm();
