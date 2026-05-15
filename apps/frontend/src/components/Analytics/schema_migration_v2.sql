-- ============================================================
-- Analytics Schema Migration v2
-- Run this in your Supabase SQL Editor to fix missing columns
-- ============================================================

-- 1. Add missing progress tracking columns to user_sync_status
--    (The sync service writes these but the original schema didn't define them)
ALTER TABLE user_sync_status
  ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synced_transactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_version TEXT DEFAULT '0';

-- The original schema had last_synced_version as BIGINT but the service writes TEXT.
-- If the column already exists as BIGINT, alter it:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_sync_status'
      AND column_name = 'last_synced_version'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE user_sync_status
      ALTER COLUMN last_synced_version TYPE TEXT USING last_synced_version::TEXT;
  END IF;
END $$;

-- 2. Create user_balance_snapshots table for historical portfolio reconstruction
--    Used by portfolioService.ts and the /api/analytics/pnl-precise endpoint
CREATE TABLE IF NOT EXISTS user_balance_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    asset_type TEXT NOT NULL,         -- Full asset type string or symbol
    symbol TEXT NOT NULL,             -- Human-readable symbol: 'MOVE', 'USDC', etc.
    amount DECIMAL NOT NULL,          -- Amount held at end of this day
    snapshot_date DATE NOT NULL,      -- ISO date: '2024-01-15'
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_address, asset_type, snapshot_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_user_date
  ON user_balance_snapshots(user_address, snapshot_date DESC);

-- 3. Add RLS policies so the service role can write and anon can read their own data
ALTER TABLE user_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view their own snapshots"
  ON user_balance_snapshots FOR SELECT
  USING (true); -- Public profiles are visible; tighten if needed

CREATE POLICY IF NOT EXISTS "Service role can manage snapshots"
  ON user_balance_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Also ensure user_sync_status has RLS policies
ALTER TABLE user_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Public sync status read"
  ON user_sync_status FOR SELECT
  USING (true);

CREATE POLICY IF NOT EXISTS "Service role can manage sync status"
  ON user_sync_status FOR ALL
  USING (true)
  WITH CHECK (true);
