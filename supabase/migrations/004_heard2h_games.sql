-- Heard 2H Betting System — Game Log Table
create table if not exists heard2h_games (
  id          uuid primary key default gen_random_uuid(),
  game_id     text not null,
  date        text not null,
  sport       text not null check (sport in ('nba', 'ncaab')),
  home_team   text not null,
  away_team   text not null,

  -- Full input + result stored as JSONB for flexibility
  input       jsonb not null,
  result      jsonb not null,

  -- Denormalized fields for queries/filtering
  bet_side         text not null default '',
  mip_totals_score int,
  mip_sides_score  int,
  mip_totals_verdict text,
  mip_sides_verdict  text,
  edge             float,
  edge_verdict     text,

  -- Result tracking
  sh_home_final   int,
  sh_away_final   int,
  game_result     text not null default '' check (game_result in ('W', 'L', 'P', '')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index if not exists idx_heard2h_games_date on heard2h_games(date);
create index if not exists idx_heard2h_games_sport on heard2h_games(sport);
create index if not exists idx_heard2h_games_result on heard2h_games(game_result);

-- RLS
alter table heard2h_games enable row level security;
create policy "Allow all for now" on heard2h_games
  for all using (true) with check (true);
