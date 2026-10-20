-- NEXUS 0007: correções encontradas na auditoria
-- Menções: comparar usernames sem diferenciar maiúsculas (coluna é citext)
create or replace function compute_mentions() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; ids uuid[];
begin
  select server_id into sid from channels where id = new.channel_id;
  select coalesce(array_agg(distinct p.id), '{}') into ids
  from (select (regexp_matches(coalesce(new.content, ''), '@([A-Za-z0-9_.]{3,32})', 'g'))[1] as u) t
  join profiles p on p.username = t.u::citext
  where p.id <> new.author_id and is_server_member(sid, p.id) and can_view_channel(new.channel_id, p.id);
  if coalesce(new.content, '') ~* '(^|\s)@everyone\M' and has_server_permission(sid, new.author_id, 'mention_everyone') then
    select coalesce(array_agg(distinct x), '{}') into ids from unnest(ids || array(
      select m.user_id from server_members m where m.server_id = sid and m.user_id <> new.author_id
        and can_view_channel(new.channel_id, m.user_id) limit 500)) x;
  end if;
  new.mentions := ids;
  return new;
end $$;
