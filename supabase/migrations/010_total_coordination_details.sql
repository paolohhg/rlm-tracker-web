-- ============================================================
-- Total Coordination Details
-- Migration: 010_total_coordination_details.sql
-- Created: March 21, 2026
--
-- Adds book-level coordination detail columns for STEAM_TOTAL
-- and SHARP_ACCUMULATION_TOTAL signals.
-- ============================================================

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS total_books_moved       INTEGER,
  ADD COLUMN IF NOT EXISTS total_books_list         TEXT,       -- comma-separated book names
  ADD COLUMN IF NOT EXISTS total_move_time_window   INTEGER,    -- minutes
  ADD COLUMN IF NOT EXISTS total_velocity           NUMERIC;    -- points per hour
