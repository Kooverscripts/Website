-- NEXUS 0004: anúncios restritos, descoberta, convites, sair de servidor

drop policy if exists cm_insert on channel_messages;
create policy cm_insert on channel_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and can_view_channel(channel_id, auth.uid())
    and has_server_permission((select server_id from channels where id = channel_id), auth.uid(), 'send_messages')
    and ((select type from channels where id = channel_id) = 'text'
         or ((select type from channels where id = channel_id) in ('announcement','media')
             and has_server_permission((select server_id from channels where id = channel_id), auth.uid(), 'manage_channels')))
  );

create or replace function rate_limit_channel_msg() returns trigger language plpgsql as $$
begin
  if (select count(*) from channel_messages where author_id = new.author_id
      and created_at > now() - interval '10 seconds') >= 15 then raise exception 'rate limit'; end if;
  return new;
end $$;
drop trigger if exists cm_rate_limit on channel_messages;
create trigger cm_rate_limit before insert on channel_messages for each row execute function rate_limit_channel_msg();

create or replace function leave_server(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select owner_id from servers where id = sid) = auth.uid() then
    raise exception 'owner cannot leave'; end if;
  delete from server_members where server_id = sid and user_id = auth.uid();
end $$;

create or replace function discover_servers(q text default '', lim int default 20, off int default 0)
returns table(id uuid, name text, description text, icon_url text, banner_url text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.description, s.icon_url, s.banner_url,
         (select count(*) from server_members m where m.server_id = s.id)
  from servers s
  where s.is_public and (q = '' or s.name ilike '%' || q || '%' or s.description ilike '%' || q || '%')
  order by 6 desc limit least(lim, 50) offset off;
$$;
grant execute on function discover_servers(text,int,int) to authenticated;

create or replace function invite_preview(p_code text)
returns table(server_id uuid, name text, member_count bigint, valid boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, (select count(*) from server_members m where m.server_id = s.id),
         not i.revoked and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)
  from server_invites i join servers s on s.id = i.server_id where i.code = p_code;
$$;
grant execute on function invite_preview(text) to authenticated;
