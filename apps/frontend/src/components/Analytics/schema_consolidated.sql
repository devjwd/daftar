-- ============================================================================
-- CONSOLIDATED DAFTAR ANALYTICS SCHEMA
-- Run this entire script in your Supabase SQL Editor to set up all tables,
-- columns, indexes, and Row Level Security (RLS) policies in one execution.
-- ============================================================================

-- 1. HISTORICAL PRICE TABLE
CREATE TABLE IF NOT EXISTS token_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_address TEXT NOT NULL,
    price DECIMAL NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    granularity TEXT DEFAULT 'daily',
    source TEXT DEFAULT 'coingecko',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_token_time ON token_price_history(token_address, timestamp DESC);

-- 2. ENRICHED TRANSACTION HISTORY
CREATE TABLE IF NOT EXISTS user_transaction_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    version BIGINT NOT NULL,
    hash TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    
    protocol TEXT,
    action TEXT,
    category TEXT,
    description TEXT,
    
    asset_in_symbol TEXT,
    asset_in_amount DECIMAL,
    asset_out_symbol TEXT,
    asset_out_amount DECIMAL,
    
    price_usd DECIMAL,
    value_usd DECIMAL,
    gas_usd DECIMAL,
    
    metadata JSONB,
    is_processed BOOLEAN DEFAULT FALSE,
    
    UNIQUE(user_address, version)
);

CREATE INDEX IF NOT EXISTS idx_user_tx_address_time ON user_transaction_history(user_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_tx_protocol ON user_transaction_history(user_address, protocol);
CREATE INDEX IF NOT EXISTS idx_user_tx_action ON user_transaction_history(user_address, action);

-- 3. SYNC STATUS TABLE
CREATE TABLE IF NOT EXISTS user_sync_status (
    user_address TEXT PRIMARY KEY,
    last_synced_version TEXT DEFAULT '0',
    full_history_synced BOOLEAN DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    sync_error TEXT,
    total_transactions INTEGER DEFAULT 0,
    synced_transactions INTEGER DEFAULT 0
);

-- Backward compatibility columns for user_sync_status
ALTER TABLE user_sync_status
  ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synced_transactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_version TEXT DEFAULT '0';

-- If last_synced_version is BIGINT, change to TEXT
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

-- 4. HISTORICAL BALANCE SNAPSHOTS
CREATE TABLE IF NOT EXISTS user_balance_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    amount DECIMAL NOT NULL,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_address, asset_type, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_user_date ON user_balance_snapshots(user_address, snapshot_date DESC);

-- 5. SYNC QUEUE TABLE
CREATE TABLE IF NOT EXISTS sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
    priority INTEGER DEFAULT 0,              -- 0 for scheduled, 10 for manual rescans
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_lookup ON sync_queue(status, priority DESC, created_at ASC);

-- 6. ROW LEVEL SECURITY (RLS) POLICIES

-- Enable RLS on tables
ALTER TABLE user_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

-- user_balance_snapshots Policies
CREATE POLICY "Users can view their own snapshots"
  ON user_balance_snapshots FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage snapshots"
  ON user_balance_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);

-- user_sync_status Policies
CREATE POLICY "Public sync status read"
  ON user_sync_status FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage sync status"
  ON user_sync_status FOR ALL
  USING (true)
  WITH CHECK (true);

-- sync_queue Policies
CREATE POLICY "Public sync queue read"
  ON sync_queue FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage sync queue"
  ON sync_queue FOR ALL
  USING (true)
  WITH CHECK (true);
