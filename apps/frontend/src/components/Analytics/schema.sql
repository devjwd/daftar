-- Advanced Analytics Database Schema (v2 - Final)
-- Location: apps/frontend/src/components/Analytics/schema.sql

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
    last_synced_version TEXT DEFAULT '0', -- Fixed: Stores string version IDs
    full_history_synced BOOLEAN DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    sync_error TEXT,
    total_transactions INTEGER DEFAULT 0,    -- Added: For progress tracking
    synced_transactions INTEGER DEFAULT 0    -- Added: For progress tracking
);

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
