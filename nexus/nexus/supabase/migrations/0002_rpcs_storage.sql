-- NEXUS 0002: RPCs seguras, hierarquia e storage

-- criação de servidor/DM só via RPC
drop policy if exists servers_insert on servers;

create or replace function is_username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where username = u);
$$;
grant execute on function is_username_available(text) to anon, authenticated;

create or replace function top_role_position(sid uuid, uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from servers where id = sid and owner_id = uid) then 2147483647
    else coalesce((select max(r.position) from member_roles mr join roles r on r.id = mr.role_id
                   where mr.server_id = sid and mr.user_id = uid), -1) end;
$$;

create or replace function log_action(sid uuid, act text, target uuid, det jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into moderation_actions(server_id, actor_id, action, target_user_id, details)
  values (sid, auth.uid(), act, target, det);
$$;

create or replace function create_server(p_name text, p_description text default null, p_is_public boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; r_owner uuid; r_admin uuid; r_mod uuid; r_member uuid; r_guest uuid; cat uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from servers where owner_id = auth.uid()) >= 20 then
    raise exception 'server limit reached'; end if;
  insert into servers(name, description, is_public, owner_id) values (p_name, p_description, p_is_public, auth.uid())
    returning id into sid;
  insert into server_members(server_id, user_id) values (sid, auth.uid());
  insert into roles(server_id,name,color,position,is_default) values (sid,'Owner','#f59e0b',100,false) returning id into r_owner;
  insert into roles(server_id,name,color,position,is_default) values (sid,'Admin','#ef4444',80,false) returning id into r_admin;
  insert into roles(server_id,name,color,position,is_default) values (sid,'Moderator','#3b82f6',60,false) returning id into r_mod;
  insert into roles(server_id,name,color,position,is_default) values (sid,'Member','#9ca3af',10,true) returning id into r_member;
  insert into roles(server_id,name,color,position,is_default) values (sid,'Guest','#6b7280',0,false) returning id into r_guest;
  insert into role_permissions(role_id, permission)
    select r_owner, unnest(array['manage_server','manage_channels','manage_roles','send_messages','attach_files','delete_messages','mention_everyone','create_invites','kick_members','ban_members','manage_pins','connect_voice','mute_members','move_members','view_audit_log']);
  insert into role_permissions(role_id, permission)
    select r_admin, unnest(array['manage_channels','manage_roles','send_messages','attach_files','delete_messages','mention_everyone','create_invites','kick_members','ban_members','manage_pins','connect_voice','mute_members','move_members','view_audit_log']);
  insert into role_permissions(role_id, permission)
    select r_mod, unnest(array['send_messages','attach_files','delete_messages','create_invites','kick_members','manage_pins','connect_voice','mute_members','view_audit_log']);
  insert into role_permissions(role_id, permission)
    select r_member, unnest(array['send_messages','attach_files','create_invites','connect_voice']);
  insert into role_permissions(role_id, permission) values (r_guest,'connect_voice');
  insert into member_roles(server_id,user_id,role_id) values (sid, auth.uid(), r_owner);
  insert into categories(server_id,name,position) values (sid,'Geral',0) returning id into cat;
  insert into channels(server_id,category_id,name,type,position) values (sid,cat,'geral','text',0),(sid,cat,'Voz','voice',1);
  perform log_action(sid,'server_created',auth.uid());
  return sid;
end $$;

create or replace function join_server_by_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv server_invites; rid uuid;
begin
  select * into inv from server_invites where code = p_code for update;
  if not found or inv.revoked or (inv.expires_at is not null and inv.expires_at < now())
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'invalid invite'; end if;
  if exists (select 1 from server_bans where server_id = inv.server_id and user_id = auth.uid()) then
    raise exception 'banned'; end if;
  insert into server_members(server_id,user_id) values (inv.server_id, auth.uid()) on conflict do nothing;
  select id into rid from roles where server_id = inv.server_id and is_default;
  insert into member_roles(server_id,user_id,role_id) values (inv.server_id, auth.uid(), rid) on conflict do nothing;
  update server_invites set uses = uses + 1 where code = p_code;
  return inv.server_id;
end $$;

create or replace function join_public_server(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not exists (select 1 from servers where id = sid and is_public) then raise exception 'not public'; end if;
  if exists (select 1 from server_bans where server_id = sid and user_id = auth.uid()) then raise exception 'banned'; end if;
  insert into server_members(server_id,user_id) values (sid, auth.uid()) on conflict do nothing;
  select id into rid from roles where server_id = sid and is_default;
  insert into member_roles(server_id,user_id,role_id) values (sid, auth.uid(), rid) on conflict do nothing;
end $$;

create or replace function kick_member(sid uuid, target uuid, reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_server_permission(sid, auth.uid(), 'kick_members') then raise exception 'forbidden'; end if;
  if target = (select owner_id from servers where id = sid)
     or top_role_position(sid, target) >= top_role_position(sid, auth.uid()) then raise exception 'hierarchy'; end if;
  delete from server_members where server_id = sid and user_id = target;
  perform log_action(sid,'kick',target,jsonb_build_object('reason',reason));
end $$;

create or replace function ban_member(sid uuid, target uuid, reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_server_permission(sid, auth.uid(), 'ban_members') then raise exception 'forbidden'; end if;
  if target = (select owner_id from servers where id = sid)
     or top_role_position(sid, target) >= top_role_position(sid, auth.uid()) then raise exception 'hierarchy'; end if;
  insert into server_bans(server_id,user_id,reason,banned_by) values (sid,target,reason,auth.uid()) on conflict do nothing;
  delete from server_members where server_id = sid and user_id = target;
  perform log_action(sid,'ban',target,jsonb_build_object('reason',reason));
end $$;

create or replace function unban_member(sid uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_server_permission(sid, auth.uid(), 'ban_members') then raise exception 'forbidden'; end if;
  delete from server_bans where server_id = sid and user_id = target;
  perform log_action(sid,'unban',target);
end $$;

create or replace function transfer_ownership(sid uuid, new_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ro uuid;
begin
  if (select owner_id from servers where id = sid) <> auth.uid() then raise exception 'forbidden'; end if;
  if not is_server_member(sid, new_owner) then raise exception 'not a member'; end if;
  update servers set owner_id = new_owner where id = sid;
  select id into ro from roles where server_id = sid and name = 'Owner';
  insert into member_roles(server_id,user_id,role_id) values (sid,new_owner,ro) on conflict do nothing;
  delete from member_roles where server_id = sid and user_id = auth.uid() and role_id = ro;
  perform log_action(sid,'transfer_ownership',new_owner);
end $$;

create or replace function start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; pref text;
begin
  if other = auth.uid() then raise exception 'self'; end if;
  if is_blocked_between(auth.uid(), other) then raise exception 'blocked'; end if;
  select who_can_dm into pref from user_settings where user_id = other;
  if pref = 'nobody' or (pref = 'friends' and not exists (
      select 1 from friendships where status = 'accepted'
        and ((requester_id = auth.uid() and addressee_id = other) or (requester_id = other and addressee_id = auth.uid()))))
  then raise exception 'dm not allowed'; end if;
  select c.id into cid from direct_conversations c
   where not c.is_group
     and exists (select 1 from direct_conversation_members where conversation_id = c.id and user_id = auth.uid())
     and exists (select 1 from direct_conversation_members where conversation_id = c.id and user_id = other) limit 1;
  if cid is null then
    insert into direct_conversations(created_by) values (auth.uid()) returning id into cid;
    insert into direct_conversation_members(conversation_id,user_id) values (cid,auth.uid()),(cid,other);
  end if;
  return cid;
end $$;

-- ===== Storage =====
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',true,5242880,array['image/png','image/jpeg','image/webp','image/gif']),
 ('banners','banners',true,8388608,array['image/png','image/jpeg','image/webp','image/gif']),
 ('attachments','attachments',false,26214400,null)
on conflict (id) do nothing;

-- upload só na pasta do próprio usuário: <uid>/arquivo
create policy "avatars read" on storage.objects for select using (bucket_id in ('avatars','banners'));
create policy "own folder write" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','banners','attachments') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own folder update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars','banners') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own folder delete" on storage.objects for delete to authenticated
  using ((storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments read own" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
