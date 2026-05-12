-- Advanced Analytics Database Schema
-- Location: apps/frontend/src/components/Analytics/schema.sql

-- 1. HISTORICAL PRICE TABLE
-- Stores daily/hourly snapshots to backfill transaction values
CREATE TABLE IF NOT EXISTS token_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_address TEXT NOT NULL,
    price DECIMAL NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    granularity TEXT DEFAULT 'daily', -- 'daily' or 'hourly'
    source TEXT DEFAULT 'coingecko',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by token and time
CREATE INDEX IF NOT EXISTS idx_price_history_token_time ON token_price_history(token_address, timestamp DESC);

-- 2. ENRICHED TRANSACTION HISTORY
-- Stores the results of our "Deep Sync" and "Enrichment" engine
CREATE TABLE IF NOT EXISTS user_transaction_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    version BIGINT NOT NULL, -- Movement network version ID
    hash TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    
    -- Analytics Tags
    protocol TEXT,           -- 'Liquidswap', 'Echelon', 'Aries', etc.
    action TEXT,             -- 'SWAP', 'DEPOSIT', 'BORROW', 'SEND', 'RECEIVE'
    category TEXT,           -- 'DeFi', 'NFT', 'Transfer'
    
    -- Human Readable Data
    description TEXT,        -- "Swapped 10 MOVE for 15 USDC"
    
    -- Financial Data (Enriched)
    asset_in_symbol TEXT,
    asset_in_amount DECIMAL,
    asset_out_symbol TEXT,
    asset_out_amount DECIMAL,
    
    -- USD Values (Initially NULL, backfilled by worker)
    price_usd DECIMAL,       -- Price of the primary asset at time of TX
    value_usd DECIMAL,       -- Total USD value of the transaction
    gas_usd DECIMAL,
    
    metadata JSONB,          -- Stores raw Movement event data for debugging
    is_processed BOOLEAN DEFAULT FALSE, -- Tagged true once price is backfilled
    
    UNIQUE(user_address, version) -- Prevents duplicate entries
);

-- Indexes for the Analytics Page
CREATE INDEX IF NOT EXISTS idx_user_tx_address_time ON user_transaction_history(user_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_tx_protocol ON user_transaction_history(user_address, protocol);
CREATE INDEX IF NOT EXISTS idx_user_tx_action ON user_transaction_history(user_address, action);

-- 3. SYNC STATUS TABLE
-- Tracks how far back we have synced each user
CREATE TABLE IF NOT EXISTS user_sync_status (
    user_address TEXT PRIMARY KEY,
    last_synced_version BIGINT DEFAULT 0,
    full_history_synced BOOLEAN DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    sync_error TEXT
);
