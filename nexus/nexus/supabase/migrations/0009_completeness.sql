-- NEXUS 0009: acessibilidade, recibos de entrega, grupos, sugestões, perfil, anti-abuso, não lidas em canais

alter table user_settings add column if not exists font_scale text not null default 'normal' check (font_scale in ('normal','large','xlarge'));

-- ===== Entregue/Lida nas DMs =====
alter table direct_conversation_members add column if not exists last_delivered_at timestamptz;
alter publication supabase_realtime add table direct_conversation_members;

-- ===== Anti-abuso =====
create or replace function rate_limit_friend_requests() returns trigger language plpgsql as $$
begin
  if (select count(*) from friendships where requester_id = new.requester_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate limit'; end if;
  return new;
end $$;
drop trigger if exists friend_rate_limit on friendships;
create trigger friend_rate_limit before insert on friendships for each row execute function rate_limit_friend_requests();

create or replace function rate_limit_invites() returns trigger language plpgsql as $$
begin
  if (select count(*) from server_invites where created_by = new.created_by and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate limit'; end if;
  return new;
end $$;
drop trigger if exists invite_rate_limit on server_invites;
create trigger invite_rate_limit before insert on server_invites for each row execute function rate_limit_invites();

-- ===== Privacidade de solicitações: "mutual" = amigo ou servidor em comum =====
create or replace function has_mutual_connection(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with fa as (select case when requester_id = a then addressee_id else requester_id end as u from friendships where status = 'accepted' and a in (requester_id, addressee_id)),
       fb as (select case when requester_id = b then addressee_id else requester_id end as u from friendships where status = 'accepted' and b in (requester_id, addressee_id))
  select (a = auth.uid() or b = auth.uid()) and (
    exists (select 1 from fa join fb using (u))
    or exists (select 1 from server_members x join server_members y on x.server_id = y.server_id where x.user_id = a and y.user_id = b));
$$;
drop policy if exists friends_insert on friendships;
create policy friends_insert on friendships for insert to authenticated
  with check (
    requester_id = auth.uid() and status = 'pending'
    and not is_blocked_between(requester_id, addressee_id)
    and (select case coalesce(who_can_friend, 'everyone') when 'nobody' then false
                     when 'mutual' then has_mutual_connection(requester_id, addressee_id) else true end
         from user_settings where user_id = addressee_id) is not false
  );

-- ===== Perfil: amigos e servidores em comum (somente o que os dois compartilham) =====
create or replace function mutual_info(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_blocked_between(auth.uid(), target) then '{"friends":[],"servers":[]}'::jsonb else jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url))
      from profiles p where
        p.id in (select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end from friendships f where f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id))
        and p.id in (select case when f.requester_id = target then f.addressee_id else f.requester_id end from friendships f where f.status = 'accepted' and target in (f.requester_id, f.addressee_id))), '[]'::jsonb),
    'servers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'icon_url', s.icon_url)) from servers s
      where exists (select 1 from server_members m where m.server_id = s.id and m.user_id = auth.uid())
        and exists (select 1 from server_members m where m.server_id = s.id and m.user_id = target)), '[]'::jsonb)) end;
$$;

-- ===== Sugestões: amigos de amigos =====
create or replace function suggest_friends()
returns table(id uuid, username text, display_name text, avatar_url text, mutual bigint)
language sql stable security definer set search_path = public as $$
  with mine as (select case when requester_id = auth.uid() then addressee_id else requester_id end as u
                from friendships where status = 'accepted' and auth.uid() in (requester_id, addressee_id)),
       theirs as (select case when f.requester_id = m.u then f.addressee_id else f.requester_id end as cand
                  from mine m join friendships f on f.status = 'accepted' and m.u in (f.requester_id, f.addressee_id))
  select p.id, p.username::text, p.display_name, p.avatar_url, count(*)
  from theirs t join profiles p on p.id = t.cand
  where p.id <> auth.uid()
    and not exists (select 1 from friendships f where auth.uid() in (f.requester_id, f.addressee_id) and p.id in (f.requester_id, f.addressee_id))
    and not is_blocked_between(auth.uid(), p.id)
  group by p.id, p.username, p.display_name, p.avatar_url
  order by 5 desc limit 10;
$$;

-- ===== Grupos de DM =====
create or replace function create_group_dm(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; m uuid;
begin
  if coalesce(array_length(p_members, 1), 0) < 2 or array_length(p_members, 1) > 9 then raise exception 'invalid size'; end if;
  foreach m in array p_members loop
    if m = auth.uid() then raise exception 'invalid'; end if;
    if not exists (select 1 from friendships where status = 'accepted'
        and ((requester_id = auth.uid() and addressee_id = m) or (requester_id = m and addressee_id = auth.uid()))) then
      raise exception 'not friend'; end if;
    if is_blocked_between(auth.uid(), m) then raise exception 'blocked'; end if;
  end loop;
  insert into direct_conversations(is_group, name, created_by) values (true, nullif(left(trim(coalesce(p_name, '')), 64), ''), auth.uid()) returning id into cid;
  insert into direct_conversation_members(conversation_id, user_id) select cid, x from unnest(p_members || auth.uid()) x;
  return cid;
end $$;

create or replace function leave_conversation(conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select is_group from direct_conversations where id = conv), false) then raise exception 'not a group'; end if;
  delete from direct_conversation_members where conversation_id = conv and user_id = auth.uid();
  if not exists (select 1 from direct_conversation_members where conversation_id = conv) then delete from direct_conversations where id = conv; end if;
end $$;

-- ===== Não lidas por canal (uma consulta só) =====
create or replace function channel_unreads(sid uuid) returns table(channel_id uuid, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, (select count(*)::int from (select 1 from channel_messages m
      where m.channel_id = c.id and m.deleted_at is null and m.author_id <> auth.uid()
        and m.created_at > coalesce((select r.last_read_at from read_receipts r where r.user_id = auth.uid() and r.channel_id = c.id),
                                    (select sm.joined_at from server_members sm where sm.server_id = sid and sm.user_id = auth.uid()))
      limit 100) x)
  from channels c
  where c.server_id = sid and c.type <> 'voice' and is_server_member(sid, auth.uid()) and can_view_channel(c.id, auth.uid());
$$;
