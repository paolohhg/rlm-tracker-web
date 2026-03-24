-- ============================================================
-- MLB Opener Tracking
-- Migration: 011_mlb_opener_tracking.sql
-- Created: March 24, 2026
--
-- Stores the first-ever odds snapshot per sportsbook/game/market
-- so opening lines are preserved and never overwritten.
-- ============================================================

-- Per-book opener table: stores the first line seen for each
-- sportsbook × game × market combination.
CREATE TABLE IF NOT EXISTS book_openers (
  id             BIGSERIAL PRIMARY KEY,
  league         TEXT NOT NULL,
  home_team      TEXT NOT NULL,
  away_team      TEXT NOT NULL,
  game_time      TIMESTAMPTZ NOT NULL,
  sportsbook     TEXT NOT NULL,
  market_type    TEXT NOT NULL,  -- 'moneyline', 'spread', 'total', 'runline'
  opener_value   NUMERIC,       -- the line/spread/total number
  opener_price   NUMERIC,       -- the juice/vig
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite unique: one opener per book × game × market
  CONSTRAINT uq_book_opener
    UNIQUE (league, home_team, away_team, game_time, sportsbook, market_type)
);

-- Index for fast lookups by game
CREATE INDEX IF NOT EXISTS idx_book_openers_game
  ON book_openers (league, home_team, away_team, game_time);

-- Index for querying by league + date range
CREATE INDEX IF NOT EXISTS idx_book_openers_league_time
  ON book_openers (league, game_time);

-- Add books_reporting column to games_master if not exists
-- (tracks how many books have posted lines for a game)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games_master'
    AND column_name = 'books_reporting'
  ) THEN
    ALTER TABLE games_master ADD COLUMN books_reporting INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games_master'
    AND column_name = 'first_odds_at'
  ) THEN
    ALTER TABLE games_master ADD COLUMN first_odds_at TIMESTAMPTZ;
  END IF;
END $$;
