-- Migration: Add Ascending Indexes for Analytics Charts (Ascending Queries)
-- Date: 2026-06-03

-- 1. Index for fast ascending query scan on transaction history
CREATE INDEX IF NOT EXISTS idx_user_tx_address_time_asc 
  ON public.user_transaction_history (user_address, timestamp ASC);

-- 2. Index for fast ascending query scan on networth snapshots
CREATE INDEX IF NOT EXISTS idx_networth_snapshots_user_ts_asc 
  ON public.user_networth_snapshots (user_address, timestamp ASC);
