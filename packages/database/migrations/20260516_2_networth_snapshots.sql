-- Migration: Add Hourly Net Worth Snapshots and PNL Baseline
-- Date: 2026-05-16

-- 1. TABLE: user_networth_snapshots
-- Stores aggregated USD value breakdown for every user every hour.
CREATE TABLE IF NOT EXISTS public.user_networth_snapshots (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address        text         NOT NULL,
  total_networth_usd  numeric      NOT NULL DEFAULT 0,
  wallet_usd          numeric      NOT NULL DEFAULT 0,
  defi_usd            numeric      NOT NULL DEFAULT 0,
  nft_usd             numeric      NOT NULL DEFAULT 0,
  net_deposits_usd    numeric      NOT NULL DEFAULT 0,
  breakdown           jsonb        NOT NULL DEFAULT '{}', -- Stores protocol-specific values
  timestamp           timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  -- Ensure unique snapshot per user per hour (approximate by rounding timestamp)
  UNIQUE(user_address, timestamp)
);

-- Index for fast time-series retrieval
CREATE INDEX IF NOT EXISTS idx_networth_snapshots_user_ts ON public.user_networth_snapshots (user_address, timestamp DESC);

-- 2. ALTER TABLE: profiles
-- Add baseline tracking for "From Now" PNL
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pnl_baseline_at    timestamptz,
ADD COLUMN IF NOT EXISTS pnl_baseline_value numeric      DEFAULT 0;

-- 3. RLS & Permissions
ALTER TABLE public.user_networth_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read for anon networth snapshots" ON public.user_networth_snapshots;
CREATE POLICY "Read for anon networth snapshots" ON public.user_networth_snapshots FOR SELECT USING (true);

GRANT SELECT ON public.user_networth_snapshots TO anon, authenticated, service_role;
GRANT ALL ON public.user_networth_snapshots TO authenticated, service_role;
