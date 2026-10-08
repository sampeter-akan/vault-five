-- VAULT FIVE database schema. Authoritative game state lives in Supabase.
-- The final vault key is never stored in this file.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4}$'),
  host_player_id uuid,
  status text not null default 'lobby' check (status in ('lobby','playing','finished')),
  current_round integer not null default 0 check (current_round between 0 and 3),
  winner_player_id uuid,
  vault_unlocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid,
  display_name text not null check (char_length(display_name) between 1 and 24),
  is_host boolean not null default false,
  connected boolean not null default true,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 3),
  round_type text not null check (round_type in ('discover','deduce','final_vault')),
  status text not null default 'pending' check (status in ('pending','active','completed')),
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(room_id, round_number)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  answer text not null check (char_length(answer) between 1 and 64),
  is_correct boolean,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  submitted_at timestamptz not null default now(),
  unique(round_id, player_id)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  points integer not null check (points >= 0),
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.players add column if not exists auth_user_id uuid;
alter table public.rooms add column if not exists winner_player_id uuid references public.players(id) on delete set null;
alter table public.rooms add column if not exists vault_unlocked boolean not null default false;

create unique index if not exists players_auth_user_id_uidx on public.players(auth_user_id) where auth_user_id is not null;
create index if not exists players_room_auth_user_idx on public.players(room_id, auth_user_id);
create index if not exists rounds_room_status_idx on public.rounds(room_id, status);
create index if not exists submissions_round_player_idx on public.submissions(round_id, player_id, submitted_at desc);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.submissions enable row level security;
alter table public.scores enable row level security;

-- Clients receive authoritative state through the authenticated Edge Function and
-- private Realtime channels; direct table writes remain blocked.

drop policy if exists "room members can view rooms" on public.rooms;
drop policy if exists "room members can view players" on public.players;
drop policy if exists "players can update own presence" on public.players;
drop policy if exists "room members can view rounds" on public.rounds;
drop policy if exists "room members can view submissions" on public.submissions;
drop policy if exists "room members can view scores" on public.scores;

create or replace function private.is_room_member(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.players
    where room_id = target_room_id and auth_user_id = auth.uid()
  );
$$;

create policy "room members can view rooms" on public.rooms
for select to authenticated using (private.is_room_member(id));

create policy "room members can view players" on public.players
for select to authenticated using (private.is_room_member(room_id));

create policy "players can update own presence" on public.players
for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

create policy "room members can view rounds" on public.rounds
for select to authenticated using (private.is_room_member(room_id));

create policy "room members can view submissions" on public.submissions
for select to authenticated using (private.is_room_member(room_id));

create policy "room members can view scores" on public.scores
for select to authenticated using (private.is_room_member(room_id));

grant select on public.rooms, public.players, public.rounds, public.submissions, public.scores to authenticated;
grant update (display_name, connected, last_seen_at) on public.players to authenticated;

alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.rounds replica identity full;
alter table public.submissions replica identity full;
alter table public.scores replica identity full;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.scores;
