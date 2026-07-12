-- season_winners_migration.sql
-- Run manually in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Adds support for multiple winners per season and migrates any winner
-- already recorded via the old single-winner seasons.winner_player_id column.

-- 1. Table
create table season_winners (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (season_id, player_id)
);

-- 2. Row Level Security (same pattern as seasons/players/season_players/draws)
alter table season_winners enable row level security;

create policy "season_winners_select_public" on season_winners
  for select using (true);

create policy "season_winners_write_admin" on season_winners
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 3. Migrate any winner already declared through the old column
insert into season_winners (season_id, player_id)
select id, winner_player_id from seasons
where winner_player_id is not null
on conflict (season_id, player_id) do nothing;
