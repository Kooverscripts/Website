-- NEXUS 0008: voz e vídeo (autorização da sinalização, moderação de voz, chamadas)

create or replace function can_join_voice(cid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels c where c.id = cid and c.type = 'voice'
    and can_view_channel(cid, uid) and has_server_permission(c.server_id, uid, 'connect_voice'));
$$;

-- Quem pode entrar em cada tópico privado do Realtime (voice:<canal> e call:<conversa>)
create or replace function rt_can_access(topic text, uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if topic ~ '^voice:[0-9a-fA-F-]{36}$' then return can_join_voice(substring(topic from 7)::uuid, uid);
  elsif topic ~ '^call:[0-9a-fA-F-]{36}$' then return is_dm_member(substring(topic from 6)::uuid, uid);
  end if;
  return false;
end $$;

create policy rt_private_read on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and rt_can_access(realtime.topic(), auth.uid()));
create policy rt_private_write on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and rt_can_access(realtime.topic(), auth.uid()));

-- Moderação de voz: o servidor valida permissão e hierarquia; o alvo recebe o comando via Realtime (RLS)
create table if not exists voice_commands (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  target_id uuid not null references profiles(id) on delete cascade,
  action text not null check (action in ('mute', 'disconnect')),
  created_at timestamptz not null default now()
);
alter table voice_commands enable row level security;
create policy vc_read on voice_commands for select to authenticated using (target_id = auth.uid());

create or replace function voice_moderate(cid uuid, target uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select server_id into sid from channels where id = cid and type = 'voice';
  if sid is null then raise exception 'not found'; end if;
  if not has_server_permission(sid, auth.uid(), case when p_action = 'mute' then 'mute_members' else 'move_members' end) then
    raise exception 'forbidden'; end if;
  if target = (select owner_id from servers where id = sid)
     or top_role_position(sid, target) >= top_role_position(sid, auth.uid()) then raise exception 'hierarchy'; end if;
  insert into voice_commands(channel_id, target_id, action) values (cid, target, p_action);
  perform log_action(sid, 'voice_' || p_action, target, jsonb_build_object('channel', cid));
end $$;
alter publication supabase_realtime add table voice_commands;

-- Chamadas privadas: notifica os outros membros da conversa (com limite de repetição)
create or replace function start_call(conv uuid, p_video boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if not is_dm_member(conv, auth.uid()) then raise exception 'forbidden'; end if;
  select username into uname from profiles where id = auth.uid();
  if exists (select 1 from notifications where type = 'call' and payload->>'conversation_id' = conv::text
             and payload->>'author' = uname and created_at > now() - interval '20 seconds') then return; end if;
  insert into notifications(user_id, type, payload)
  select m.user_id, 'call', jsonb_build_object('author', uname, 'conversation_id', conv, 'video', p_video)
  from direct_conversation_members m
  where m.conversation_id = conv and m.user_id <> auth.uid() and not is_blocked_between(auth.uid(), m.user_id);
end $$;
