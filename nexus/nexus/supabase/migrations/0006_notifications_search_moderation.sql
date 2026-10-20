-- NEXUS 0006: notificações (geradas no servidor), silenciar, fixar, bloqueio, denúncias, conta

create extension if not exists pg_trgm with schema extensions;
create index if not exists dm_content_trgm on direct_messages using gin (content extensions.gin_trgm_ops);
create index if not exists cm_content_trgm on channel_messages using gin (content extensions.gin_trgm_ops);

-- ===== Endurecimento: helpers não revelam dados de terceiros a quem não é do contexto =====
create or replace function is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (a = auth.uid() or b = auth.uid() or auth.uid() is null)
     and exists (select 1 from blocked_users
       where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
create or replace function is_server_member(sid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members where server_id = sid and user_id = uid)
     and (uid = auth.uid() or auth.uid() is null
          or exists (select 1 from server_members where server_id = sid and user_id = auth.uid()));
$$;
create or replace function is_dm_member(conv uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from direct_conversation_members where conversation_id = conv and user_id = uid)
     and (uid = auth.uid() or auth.uid() is null
          or exists (select 1 from direct_conversation_members where conversation_id = conv and user_id = auth.uid()));
$$;

-- ===== FKs que impediam excluir contas =====
alter table server_invites drop constraint if exists server_invites_created_by_fkey;
alter table server_invites add constraint server_invites_created_by_fkey foreign key (created_by) references profiles(id) on delete cascade;
alter table server_bans drop constraint if exists server_bans_banned_by_fkey;
alter table server_bans add constraint server_bans_banned_by_fkey foreign key (banned_by) references profiles(id) on delete set null;
alter table moderation_actions alter column actor_id drop not null;
alter table moderation_actions drop constraint if exists moderation_actions_actor_id_fkey;
alter table moderation_actions add constraint moderation_actions_actor_id_fkey foreign key (actor_id) references profiles(id) on delete set null;

-- ===== Silenciar servidor/canal =====
create table if not exists notification_mutes (
  user_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('server','channel')),
  target_id uuid not null,
  primary key (user_id, target_type, target_id)
);
alter table notification_mutes enable row level security;
create policy mutes_own on notification_mutes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function is_muted(uid uuid, sid uuid, cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from notification_mutes where user_id = uid and
    ((target_type = 'server' and target_id = sid) or (target_type = 'channel' and target_id = cid)));
$$;

-- ===== Notificações: criadas por triggers (não falsificáveis por outros usuários) =====
create or replace function notify_friendship() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if tg_op = 'INSERT' then
    select username into uname from profiles where id = new.requester_id;
    insert into notifications(user_id, type, payload)
      values (new.addressee_id, 'friend_request', jsonb_build_object('author', uname));
  elsif new.status = 'accepted' and old.status = 'pending' then
    select username into uname from profiles where id = new.addressee_id;
    insert into notifications(user_id, type, payload)
      values (new.requester_id, 'friend_accepted', jsonb_build_object('author', uname));
  end if;
  return new;
end $$;
drop trigger if exists friendship_notify on friendships;
create trigger friendship_notify after insert or update on friendships for each row execute function notify_friendship();

create or replace function notify_dm() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select username into uname from profiles where id = new.author_id;
  insert into notifications(user_id, type, payload)
  select m.user_id, 'dm', jsonb_build_object('author', uname, 'conversation_id', new.conversation_id,
         'preview', left(coalesce(new.content, '[anexo]'), 80))
  from direct_conversation_members m join user_settings s on s.user_id = m.user_id
  where m.conversation_id = new.conversation_id and m.user_id <> new.author_id
    and not m.muted and s.notify_dm and not is_blocked_between(new.author_id, m.user_id);
  return new;
end $$;
drop trigger if exists dm_notify on direct_messages;
create trigger dm_notify after insert on direct_messages for each row execute function notify_dm();

create or replace function compute_mentions() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; ids uuid[];
begin
  select server_id into sid from channels where id = new.channel_id;
  select coalesce(array_agg(distinct p.id), '{}') into ids
  from (select (regexp_matches(coalesce(new.content, ''), '@([A-Za-z0-9_.]{3,32})', 'g'))[1] as u) t
  join profiles p on p.username = t.u
  where p.id <> new.author_id and is_server_member(sid, p.id) and can_view_channel(new.channel_id, p.id);
  if coalesce(new.content, '') ~* '(^|\s)@everyone\M' and has_server_permission(sid, new.author_id, 'mention_everyone') then
    select coalesce(array_agg(distinct x), '{}') into ids from unnest(ids || array(
      select m.user_id from server_members m where m.server_id = sid and m.user_id <> new.author_id
        and can_view_channel(new.channel_id, m.user_id) limit 500)) x;
  end if;
  new.mentions := ids;
  return new;
end $$;
drop trigger if exists cm_mentions on channel_messages;
create trigger cm_mentions before insert on channel_messages for each row execute function compute_mentions();

create or replace function notify_mentions() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text; cname text; sid uuid; sname text;
begin
  if coalesce(array_length(new.mentions, 1), 0) = 0 then return new; end if;
  select c.server_id, c.name, sv.name into sid, cname, sname from channels c join servers sv on sv.id = c.server_id where c.id = new.channel_id;
  select username into uname from profiles where id = new.author_id;
  insert into notifications(user_id, type, payload)
  select u, 'mention', jsonb_build_object('author', uname, 'channel_id', new.channel_id, 'channel', cname,
         'server_id', sid, 'server', sname, 'preview', left(coalesce(new.content, ''), 80))
  from unnest(new.mentions) u join user_settings us on us.user_id = u
  where us.notify_mentions and not is_muted(u, sid, new.channel_id) and not is_blocked_between(new.author_id, u);
  return new;
end $$;
drop trigger if exists cm_notify on channel_messages;
create trigger cm_notify after insert on channel_messages for each row execute function notify_mentions();

create or replace function notify_moderation() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_user_id is not null and new.action in ('kick', 'ban', 'unban') then
    insert into notifications(user_id, type, payload)
    values (new.target_user_id, 'moderation', jsonb_build_object('action', new.action,
            'server', (select name from servers where id = new.server_id)));
  end if;
  return new;
end $$;
drop trigger if exists mod_notify on moderation_actions;
create trigger mod_notify after insert on moderation_actions for each row execute function notify_moderation();

-- notificações só podem ser lidas/marcadas pelo dono; criação apenas pelos triggers
drop policy if exists notif_own on notifications;
create policy notif_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on notifications for delete to authenticated using (user_id = auth.uid());

-- ===== Fixar mensagens =====
create or replace function pin_message(p_table text, p_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid; sid uuid;
begin
  if p_table = 'direct_messages' then
    select conversation_id into cid from direct_messages where id = p_id;
    if cid is null or not is_dm_member(cid, auth.uid()) then raise exception 'forbidden'; end if;
    update direct_messages set pinned = p_pinned where id = p_id;
  elsif p_table = 'channel_messages' then
    select channel_id into cid from channel_messages where id = p_id;
    select server_id into sid from channels where id = cid;
    if sid is null or not can_view_channel(cid, auth.uid()) or not has_server_permission(sid, auth.uid(), 'manage_pins') then
      raise exception 'forbidden'; end if;
    update channel_messages set pinned = p_pinned where id = p_id;
  else raise exception 'invalid'; end if;
end $$;

-- ===== Bloqueio =====
create or replace function block_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if target = auth.uid() then raise exception 'self'; end if;
  insert into blocked_users(blocker_id, blocked_id) values (auth.uid(), target) on conflict do nothing;
  delete from friendships where (requester_id = auth.uid() and addressee_id = target)
                             or (requester_id = target and addressee_id = auth.uid());
end $$;

-- ===== Denúncias e análise =====
alter table moderation_reports add column if not exists evidence text;
create unique index if not exists reports_open_uniq on moderation_reports (reporter_id, target_type, target_id)
  where status in ('open', 'reviewing');

create table if not exists platform_admins (user_id uuid primary key references profiles(id) on delete cascade);
alter table platform_admins enable row level security;  -- sem policies: só via funções
create or replace function is_platform_admin(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select uid = auth.uid() and exists (select 1 from platform_admins where user_id = uid);
$$;
create or replace function am_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function report_content(p_type report_target, p_target uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid; ev text; cid uuid;
begin
  if char_length(trim(p_reason)) not between 3 and 1000 then raise exception 'invalid'; end if;
  if (select count(*) from moderation_reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limit'; end if;
  if p_type = 'message' then
    select m.channel_id, left(m.content, 1000) into cid, ev from channel_messages m where m.id = p_target;
    if cid is not null then
      if not can_view_channel(cid, auth.uid()) then raise exception 'forbidden'; end if;
      select server_id into sid from channels where id = cid;
    else
      select d.conversation_id, left(d.content, 1000) into cid, ev from direct_messages d where d.id = p_target;
      if cid is null or not is_dm_member(cid, auth.uid()) then raise exception 'forbidden'; end if;
      sid := null;  -- denúncias de DM vão só para a plataforma, com a evidência copiada
    end if;
  elsif p_type = 'server' then
    if not is_server_member(p_target, auth.uid()) then raise exception 'forbidden'; end if;
    sid := null;    -- denúncia contra o servidor não vai para a moderação dele
  else
    if not exists (select 1 from profiles where id = p_target) then raise exception 'not found'; end if;
    sid := null;
  end if;
  insert into moderation_reports(reporter_id, target_type, target_id, server_id, reason, evidence)
  values (auth.uid(), p_type, p_target, sid, trim(p_reason), ev);
end $$;

create or replace function list_reports(p_server uuid default null)
returns table(id uuid, target_type report_target, target_id uuid, server_id uuid, reason text, evidence text,
              status report_status, created_at timestamptz, reporter text)
language plpgsql security definer set search_path = public as $$
begin
  if p_server is null then
    if not is_platform_admin(auth.uid()) then raise exception 'forbidden'; end if;
    return query select r.id, r.target_type, r.target_id, r.server_id, r.reason, r.evidence, r.status, r.created_at, p.username::text
      from moderation_reports r join profiles p on p.id = r.reporter_id
      where r.status in ('open', 'reviewing') order by r.created_at desc limit 100;
  else
    if not has_server_permission(p_server, auth.uid(), 'kick_members') then raise exception 'forbidden'; end if;
    return query select r.id, r.target_type, r.target_id, r.server_id, r.reason, r.evidence, r.status, r.created_at, p.username::text
      from moderation_reports r join profiles p on p.id = r.reporter_id
      where r.server_id = p_server and r.status in ('open', 'reviewing') order by r.created_at desc limit 100;
  end if;
end $$;

create or replace function resolve_report(rid uuid, p_status report_status) returns void
language plpgsql security definer set search_path = public as $$
declare r moderation_reports;
begin
  select * into r from moderation_reports where id = rid;
  if not found then raise exception 'not found'; end if;
  if r.server_id is null then
    if not is_platform_admin(auth.uid()) then raise exception 'forbidden'; end if;
  elsif not has_server_permission(r.server_id, auth.uid(), 'kick_members') then raise exception 'forbidden'; end if;
  update moderation_reports set status = p_status where id = rid;
end $$;

-- ===== Conta =====
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from servers where owner_id = auth.uid()) then raise exception 'owns servers'; end if;
  delete from auth.users where id = auth.uid();
end $$;
