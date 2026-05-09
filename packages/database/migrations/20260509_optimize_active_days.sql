-- =============================================================================
-- PERFORMANCE OPTIMIZATION: ACTIVE DAYS INDEX
-- Speed up badge evaluation for high-frequency users.
-- =============================================================================

-- Add a functional index to speed up COUNT(DISTINCT tx_timestamp::date)
CREATE INDEX IF NOT EXISTS idx_txs_wallet_date ON public.transaction_history (wallet_address, (tx_timestamp::date));

-- Analyze the table to update statistics
ANALYZE public.transaction_history;
