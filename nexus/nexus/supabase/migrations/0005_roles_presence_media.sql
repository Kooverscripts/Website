-- NEXUS 0005: presença sem vazamento, cargos (RPC com hierarquia), canais privados, reações e anexos

-- ===== Presença: a preferência fica privada; o status ao vivo vem do Realtime Presence =====
alter table user_settings add column if not exists presence_pref presence_status not null default 'online';
alter table user_settings drop constraint if exists presence_pref_ok;
alter table user_settings add constraint presence_pref_ok check (presence_pref in ('online','away','dnd','invisible'));
update profiles set presence = 'offline';
create or replace function force_offline_presence() returns trigger language plpgsql as $$
begin new.presence := 'offline'; return new; end $$;
drop trigger if exists profiles_force_offline on profiles;
create trigger profiles_force_offline before insert or update on profiles
  for each row execute function force_offline_presence();

-- ===== Cargos: escrita somente via RPC (respeita hierarquia) =====
drop policy if exists roles_write on roles;

create or replace function my_perms(sid uuid, uid uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from servers where id = sid and owner_id = uid)
    then array['manage_server','manage_channels','manage_roles','send_messages','attach_files','delete_messages',
               'mention_everyone','create_invites','kick_members','ban_members','manage_pins','connect_voice',
               'mute_members','move_members','view_audit_log']
    else coalesce((select array_agg(distinct rp.permission) from member_roles mr
                   join role_permissions rp on rp.role_id = mr.role_id
                   where mr.server_id = sid and mr.user_id = uid), '{}') end;
$$;

create or replace function create_role(sid uuid, p_name text, p_color text, p_perms text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; mytop int; pos int;
begin
  if not has_server_permission(sid, auth.uid(), 'manage_roles') then raise exception 'forbidden'; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' or char_length(trim(p_name)) not between 1 and 32 then raise exception 'invalid'; end if;
  if not (p_perms <@ my_perms(sid, auth.uid())) then raise exception 'forbidden'; end if;
  mytop := top_role_position(sid, auth.uid());
  pos := least(mytop - 1, 50);
  if pos < 1 then raise exception 'hierarchy'; end if;
  insert into roles(server_id, name, color, position) values (sid, trim(p_name), p_color, pos) returning id into rid;
  insert into role_permissions(role_id, permission) select rid, unnest(p_perms);
  perform log_action(sid, 'role_created', null, jsonb_build_object('role', p_name));
  return rid;
end $$;

create or replace function update_role(rid uuid, p_name text, p_color text, p_perms text[], p_pos int) returns void
language plpgsql security definer set search_path = public as $$
declare r roles; mytop int; mine text[]; lacks_old text[]; lacks_new text[];
begin
  select * into r from roles where id = rid;
  if not found then raise exception 'not found'; end if;
  if not has_server_permission(r.server_id, auth.uid(), 'manage_roles') then raise exception 'forbidden'; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' or char_length(trim(p_name)) not between 1 and 32 or p_pos < 0 then raise exception 'invalid'; end if;
  mytop := top_role_position(r.server_id, auth.uid());
  if r.name = 'Owner' or r.position >= mytop or p_pos >= mytop then raise exception 'hierarchy'; end if;
  mine := my_perms(r.server_id, auth.uid());
  -- não pode conceder nem retirar permissões que você mesmo não possui
  lacks_old := array(select permission from role_permissions where role_id = rid and not (permission = any(mine)));
  lacks_new := array(select p from unnest(p_perms) p where not (p = any(mine)));
  if not (lacks_old <@ lacks_new and lacks_new <@ lacks_old) then raise exception 'forbidden'; end if;
  update roles set name = trim(p_name), color = p_color, position = p_pos where id = rid;
  delete from role_permissions where role_id = rid;
  insert into role_permissions(role_id, permission) select rid, unnest(p_perms);
  perform log_action(r.server_id, 'role_updated', null, jsonb_build_object('role', p_name));
end $$;

create or replace function delete_role(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r roles;
begin
  select * into r from roles where id = rid;
  if not found then raise exception 'not found'; end if;
  if not has_server_permission(r.server_id, auth.uid(), 'manage_roles') then raise exception 'forbidden'; end if;
  if r.is_default or r.name = 'Owner' or r.position >= top_role_position(r.server_id, auth.uid()) then raise exception 'hierarchy'; end if;
  delete from roles where id = rid;
  perform log_action(r.server_id, 'role_deleted', null, jsonb_build_object('role', r.name));
end $$;

create or replace function assign_role(sid uuid, uid uuid, rid uuid, p_add boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r roles; mytop int;
begin
  if not has_server_permission(sid, auth.uid(), 'manage_roles') then raise exception 'forbidden'; end if;
  select * into r from roles where id = rid and server_id = sid;
  if not found then raise exception 'not found'; end if;
  mytop := top_role_position(sid, auth.uid());
  if r.name = 'Owner' or r.position >= mytop then raise exception 'hierarchy'; end if;
  if uid <> auth.uid() and top_role_position(sid, uid) >= mytop then raise exception 'hierarchy'; end if;
  if not is_server_member(sid, uid) then raise exception 'not a member'; end if;
  if p_add then insert into member_roles(server_id, user_id, role_id) values (sid, uid, rid) on conflict do nothing;
  else delete from member_roles where server_id = sid and user_id = uid and role_id = rid; end if;
  perform log_action(sid, case when p_add then 'role_assigned' else 'role_removed' end, uid, jsonb_build_object('role', r.name));
end $$;

-- ===== Canais privados =====
create policy cra_read on channel_role_access for select to authenticated
  using (has_server_permission((select server_id from channels where id = channel_id), auth.uid(), 'manage_channels'));

create or replace function set_channel_access(cid uuid, p_private boolean, p_roles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select server_id into sid from channels where id = cid;
  if sid is null or not has_server_permission(sid, auth.uid(), 'manage_channels') then raise exception 'forbidden'; end if;
  update channels set is_private = p_private where id = cid;
  delete from channel_role_access where channel_id = cid;
  if p_private then
    insert into channel_role_access(channel_id, role_id) select cid, r.id from roles r where r.server_id = sid and r.id = any(p_roles);
  end if;
  perform log_action(sid, 'channel_access', null, jsonb_build_object('channel', cid, 'private', p_private));
end $$;

-- ===== Reações e anexos: visíveis somente a quem vê a mensagem =====
create or replace function can_see_message(cm uuid, dm uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (cm is not null and exists (select 1 from channel_messages m where m.id = cm and can_view_channel(m.channel_id, uid)))
      or (dm is not null and exists (select 1 from direct_messages d where d.id = dm and is_dm_member(d.conversation_id, uid)));
$$;

drop policy if exists react_read on message_reactions;
drop policy if exists react_own on message_reactions;
create policy react_read on message_reactions for select to authenticated
  using (can_see_message(channel_message_id, direct_message_id, auth.uid()));
create policy react_insert on message_reactions for insert to authenticated
  with check (user_id = auth.uid() and char_length(emoji) <= 16 and can_see_message(channel_message_id, direct_message_id, auth.uid()));
create policy react_delete on message_reactions for delete to authenticated using (user_id = auth.uid());

alter table message_attachments drop constraint if exists att_mime_ok;
alter table message_attachments add constraint att_mime_ok check (mime_type in
  ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','application/pdf','text/plain','application/zip'));
update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','application/pdf','text/plain','application/zip']
  where id = 'attachments';

drop policy if exists att_read on message_attachments;
create policy att_read on message_attachments for select to authenticated
  using (can_see_message(channel_message_id, direct_message_id, auth.uid()));
create policy att_insert on message_attachments for insert to authenticated
  with check (
    storage_path like auth.uid()::text || '/%'
    and ((direct_message_id is not null and exists (select 1 from direct_messages d where d.id = direct_message_id and d.author_id = auth.uid()))
      or (channel_message_id is not null and exists (select 1 from channel_messages m join channels c on c.id = m.channel_id
            where m.id = channel_message_id and m.author_id = auth.uid()
              and has_server_permission(c.server_id, auth.uid(), 'attach_files')))));

create policy "attachments read via message" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and exists (select 1 from message_attachments a
    where a.storage_path = name and can_see_message(a.channel_message_id, a.direct_message_id, auth.uid())));

alter publication supabase_realtime add table message_attachments;
