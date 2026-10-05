-- Vault Five production schema. Keep the vault secret out of this file.
create table if not exists public.games (
  room_code text primary key,
  status text not null default 'lobby' check (status in ('lobby','round1','round2','final','result')),
  round_ends_at timestamptz,
  host_id uuid not null,
  winner_id uuid,
  vault_unlocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key,
  room_code text not null references public.games(room_code) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 18),
  score integer not null default 0,
  connected boolean not null default true,
  is_host boolean not null default false,
  submitted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;
alter table public.players enable row level security;

-- Clients should not read/write authoritative state directly. Edge Functions use service role.
create policy "deny direct game reads" on public.games for select using (false);
create policy "deny direct game writes" on public.games for all using (false) with check (false);
create policy "deny direct player reads" on public.players for select using (false);
create policy "deny direct player writes" on public.players for all using (false) with check (false);

-- Enable realtime so clients can receive server-published state changes.
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.players;
