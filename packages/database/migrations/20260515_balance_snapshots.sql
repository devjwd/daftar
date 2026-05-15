-- Migration: Add User Balance Snapshots and Historical Price Tables
-- Date: 2026-05-15

-- 1. TABLE: user_balance_snapshots
-- Stores daily balance snapshots for every asset a user holds.
-- This is used to reconstruct historical portfolio value without re-aggregating thousands of txs.
CREATE TABLE IF NOT EXISTS public.user_balance_snapshots (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address    text         NOT NULL,
  asset_type      text         NOT NULL,
  symbol          text,
  amount          numeric      NOT NULL,
  snapshot_date   date         NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  -- Ensure one snapshot per user per asset per day
  UNIQUE(user_address, asset_type, snapshot_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_user_date ON public.user_balance_snapshots (user_address, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_asset ON public.user_balance_snapshots (asset_type);

-- 2. TABLE: token_price_history (Ensure it exists for backfilling)
CREATE TABLE IF NOT EXISTS public.token_price_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address   text         NOT NULL,
  price           numeric      NOT NULL,
  timestamp       timestamptz  NOT NULL,
  granularity     text         NOT NULL DEFAULT 'daily', -- 'daily', 'hourly', etc.
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(token_address, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_price_history_token_ts ON public.token_price_history (token_address, timestamp DESC);

-- Enable RLS
ALTER TABLE public.user_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_price_history ENABLE ROW LEVEL SECURITY;

-- Simple public read policies
CREATE POLICY "Public read balance snapshots" ON public.user_balance_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read token price history" ON public.token_price_history FOR SELECT USING (true);
