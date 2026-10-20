-- NEXUS: migração inicial (Supabase / PostgreSQL)
-- Execute no SQL Editor do Supabase ou via `supabase db push`.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ========== ENUMS ==========
create type presence_status as enum ('online','away','dnd','invisible','offline');
create type friend_status as enum ('pending','accepted');
create type channel_type as enum ('text','voice','announcement','media');
create type report_status as enum ('open','reviewing','resolved','dismissed');
create type report_target as enum ('user','message','server');

-- ========== PERFIS ==========
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null check (username ~ '^[a-zA-Z0-9_.]{3,32}$'),
  display_name text check (char_length(display_name) <= 48),
  avatar_url text,
  banner_url text,
  bio text check (char_length(bio) <= 500),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$') default '#7c3aed',
  pronouns text check (char_length(pronouns) <= 24),
  status_text text check (char_length(status_text) <= 80),
  status_emoji text,
  social_links jsonb not null default '[]',
  presence presence_status not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark','light','custom')),
  language text not null default 'pt-BR',
  who_can_dm text not null default 'everyone' check (who_can_dm in ('everyone','friends','nobody')),
  who_can_friend text not null default 'everyone' check (who_can_friend in ('everyone','mutual','nobody')),
  notify_dm boolean not null default true,
  notify_mentions boolean not null default true,
  reduce_motion boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Cria perfil + settings automaticamente após cadastro
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, display_name)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text,1,8)),
          coalesce(new.raw_user_meta_data->>'username', 'user'));
  insert into user_settings (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ========== AMIZADES / BLOQUEIOS ==========
create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status friend_status not null default 'pending',
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
-- impede duplicatas em qualquer direção
create unique index friendships_pair_uniq on friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table blocked_users (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create or replace function is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocked_users
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ========== DMs ==========
create table direct_conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table direct_conversation_members (
  conversation_id uuid not null references direct_conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  archived boolean not null default false,
  muted boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on direct_conversation_members (user_id);

create or replace function is_dm_member(conv uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from direct_conversation_members
                 where conversation_id = conv and user_id = uid);
$$;

create table direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references direct_conversations(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content text check (char_length(content) <= 4000),
  reply_to uuid references direct_messages(id) on delete set null,
  pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(content,''))) stored
);
create index on direct_messages (conversation_id, created_at desc);
create index dm_search_idx on direct_messages using gin (search);

-- ========== SERVIDORES ==========
create table servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 64),
  slug citext unique,
  description text check (char_length(description) <= 500),
  icon_url text,
  banner_url text,
  owner_id uuid not null references profiles(id),
  is_public boolean not null default false,
  rules text,
  max_voice_users int not null default 25,
  created_at timestamptz not null default now()
);

create table server_members (
  server_id uuid not null references servers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  nickname text,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index on server_members (user_id);

create table server_bans (
  server_id uuid not null references servers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reason text,
  banned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table server_invites (
  code text primary key default encode(gen_random_bytes(6), 'hex'),
  server_id uuid not null references servers(id) on delete cascade,
  created_by uuid not null references profiles(id),
  max_uses int,
  uses int not null default 0,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- ========== CARGOS / PERMISSÕES ==========
create table roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  name text not null,
  color text default '#9ca3af',
  position int not null default 0,        -- maior = mais alto na hierarquia
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null check (permission in (
    'manage_server','manage_channels','manage_roles','send_messages','attach_files',
    'delete_messages','mention_everyone','create_invites','kick_members','ban_members',
    'manage_pins','connect_voice','mute_members','move_members','view_audit_log')),
  primary key (role_id, permission)
);

create table member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references server_members(server_id, user_id) on delete cascade
);

-- ========== CATEGORIAS / CANAIS ==========
create table categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  name text not null,
  position int not null default 0
);

create table channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 64),
  type channel_type not null default 'text',
  topic text,
  is_private boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on channels (server_id, position);

-- canais privados: quais cargos enxergam
create table channel_role_access (
  channel_id uuid not null references channels(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (channel_id, role_id)
);

-- ========== FUNÇÕES DE AUTORIZAÇÃO (server-side) ==========
create or replace function is_server_member(sid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members where server_id = sid and user_id = uid);
$$;

create or replace function has_server_permission(sid uuid, uid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from servers where id = sid and owner_id = uid)
      or exists (
        select 1 from member_roles mr
        join role_permissions rp on rp.role_id = mr.role_id
        where mr.server_id = sid and mr.user_id = uid and rp.permission = perm);
$$;

create or replace function can_view_channel(cid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    where c.id = cid and is_server_member(c.server_id, uid)
      and (not c.is_private
           or exists (select 1 from servers s where s.id = c.server_id and s.owner_id = uid)
           or exists (select 1 from channel_role_access a
                      join member_roles mr on mr.role_id = a.role_id
                      where a.channel_id = c.id and mr.user_id = uid)));
$$;

-- ========== MENSAGENS DE CANAL ==========
create table channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content text check (char_length(content) <= 4000),
  reply_to uuid references channel_messages(id) on delete set null,
  mentions uuid[] not null default '{}',
  pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(content,''))) stored
);
create index on channel_messages (channel_id, created_at desc);
create index cm_search_idx on channel_messages using gin (search);

create table message_reactions (
  id uuid primary key default gen_random_uuid(),
  channel_message_id uuid references channel_messages(id) on delete cascade,
  direct_message_id uuid references direct_messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  check ((channel_message_id is null) <> (direct_message_id is null)),
  unique nulls not distinct (channel_message_id, direct_message_id, user_id, emoji)
);

create table message_attachments (
  id uuid primary key default gen_random_uuid(),
  channel_message_id uuid references channel_messages(id) on delete cascade,
  direct_message_id uuid references direct_messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes <= 26214400), -- 25 MB
  created_at timestamptz not null default now(),
  check ((channel_message_id is null) <> (direct_message_id is null))
);

create table read_receipts (
  user_id uuid not null references profiles(id) on delete cascade,
  channel_id uuid references channels(id) on delete cascade,
  conversation_id uuid references direct_conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  check ((channel_id is null) <> (conversation_id is null)),
  unique nulls not distinct (user_id, channel_id, conversation_id)
);

-- ========== NOTIFICAÇÕES / MODERAÇÃO ==========
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read, created_at desc);

create table moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type report_target not null,
  target_id uuid not null,
  server_id uuid references servers(id) on delete cascade,
  reason text not null check (char_length(reason) <= 1000),
  status report_status not null default 'open',
  created_at timestamptz not null default now()
);

create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  actor_id uuid not null references profiles(id),
  action text not null,
  target_user_id uuid references profiles(id),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ========== ROW LEVEL SECURITY ==========
alter table profiles enable row level security;
alter table user_settings enable row level security;
alter table friendships enable row level security;
alter table blocked_users enable row level security;
alter table direct_conversations enable row level security;
alter table direct_conversation_members enable row level security;
alter table direct_messages enable row level security;
alter table servers enable row level security;
alter table server_members enable row level security;
alter table server_bans enable row level security;
alter table server_invites enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table member_roles enable row level security;
alter table categories enable row level security;
alter table channels enable row level security;
alter table channel_role_access enable row level security;
alter table channel_messages enable row level security;
alter table message_reactions enable row level security;
alter table message_attachments enable row level security;
alter table read_receipts enable row level security;
alter table notifications enable row level security;
alter table moderation_reports enable row level security;
alter table moderation_actions enable row level security;

-- Perfis: legíveis por usuários autenticados; edição só do próprio
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy settings_own on user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Amizades
create policy friends_read on friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy friends_insert on friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending'
              and not is_blocked_between(requester_id, addressee_id));
create policy friends_update on friendships for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
create policy friends_delete on friendships for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

create policy blocks_own on blocked_users for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- DMs
create policy dmc_read on direct_conversations for select to authenticated
  using (is_dm_member(id, auth.uid()));
create policy dmm_read on direct_conversation_members for select to authenticated
  using (is_dm_member(conversation_id, auth.uid()));
create policy dmm_update_self on direct_conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dm_read on direct_messages for select to authenticated
  using (is_dm_member(conversation_id, auth.uid()));
create policy dm_insert on direct_messages for insert to authenticated
  with check (author_id = auth.uid() and is_dm_member(conversation_id, auth.uid()));
create policy dm_update_own on direct_messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Servidores
create policy servers_read on servers for select to authenticated
  using (is_public or is_server_member(id, auth.uid()));
create policy servers_insert on servers for insert to authenticated
  with check (owner_id = auth.uid());
create policy servers_update on servers for update to authenticated
  using (has_server_permission(id, auth.uid(), 'manage_server'));
create policy servers_delete on servers for delete to authenticated
  using (owner_id = auth.uid());

create policy sm_read on server_members for select to authenticated
  using (is_server_member(server_id, auth.uid()));
create policy sm_leave on server_members for delete to authenticated
  using (user_id = auth.uid() or has_server_permission(server_id, auth.uid(), 'kick_members'));

create policy bans_read on server_bans for select to authenticated
  using (has_server_permission(server_id, auth.uid(), 'ban_members'));
create policy invites_read on server_invites for select to authenticated
  using (is_server_member(server_id, auth.uid()));
create policy invites_insert on server_invites for insert to authenticated
  with check (created_by = auth.uid() and has_server_permission(server_id, auth.uid(), 'create_invites'));
create policy invites_update on server_invites for update to authenticated
  using (has_server_permission(server_id, auth.uid(), 'create_invites'));

create policy roles_read on roles for select to authenticated
  using (is_server_member(server_id, auth.uid()));
create policy roles_write on roles for all to authenticated
  using (has_server_permission(server_id, auth.uid(), 'manage_roles'))
  with check (has_server_permission(server_id, auth.uid(), 'manage_roles'));
create policy rp_read on role_permissions for select to authenticated
  using (exists (select 1 from roles r where r.id = role_id and is_server_member(r.server_id, auth.uid())));
create policy mr_read on member_roles for select to authenticated
  using (is_server_member(server_id, auth.uid()));

create policy cat_read on categories for select to authenticated
  using (is_server_member(server_id, auth.uid()));
create policy cat_write on categories for all to authenticated
  using (has_server_permission(server_id, auth.uid(), 'manage_channels'))
  with check (has_server_permission(server_id, auth.uid(), 'manage_channels'));
create policy ch_read on channels for select to authenticated
  using (can_view_channel(id, auth.uid()));
create policy ch_write on channels for all to authenticated
  using (has_server_permission(server_id, auth.uid(), 'manage_channels'))
  with check (has_server_permission(server_id, auth.uid(), 'manage_channels'));

-- Mensagens de canal
create policy cm_read on channel_messages for select to authenticated
  using (can_view_channel(channel_id, auth.uid()));
create policy cm_insert on channel_messages for insert to authenticated
  with check (author_id = auth.uid() and can_view_channel(channel_id, auth.uid())
    and has_server_permission((select server_id from channels where id = channel_id),
                              auth.uid(), 'send_messages'));
create policy cm_update_own on channel_messages for update to authenticated
  using (author_id = auth.uid()
         or has_server_permission((select server_id from channels where id = channel_id), auth.uid(), 'delete_messages'));

-- Reações / anexos / leitura / notificações / moderação
create policy react_read on message_reactions for select to authenticated using (true);
create policy react_own on message_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy att_read on message_attachments for select to authenticated using (true);
create policy rr_own on read_receipts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_own on notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reports_insert on moderation_reports for insert to authenticated
  with check (reporter_id = auth.uid());
create policy reports_read on moderation_reports for select to authenticated
  using (reporter_id = auth.uid()
         or (server_id is not null and has_server_permission(server_id, auth.uid(), 'kick_members')));
create policy actions_read on moderation_actions for select to authenticated
  using (has_server_permission(server_id, auth.uid(), 'view_audit_log'));

-- Realtime
alter publication supabase_realtime add table
  direct_messages, channel_messages, message_reactions, friendships,
  notifications, channels, categories, server_members, profiles;
