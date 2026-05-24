-- ============================================================
-- Analytics Schema Migration v3
-- Run this in your Supabase SQL Editor to create the sync queue
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
    priority INTEGER DEFAULT 0,              -- 0 for scheduled, 10 for manual rescans
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on status, priority, and date for fast processing queue lookups
CREATE INDEX IF NOT EXISTS idx_sync_queue_lookup 
  ON sync_queue(status, priority DESC, created_at ASC);

-- Enable RLS
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Public sync queue read"
  ON sync_queue FOR SELECT
  USING (true);

CREATE POLICY IF NOT EXISTS "Service role can manage sync queue"
  ON sync_queue FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. DYNAMIC PROTOCOL MIGRATION
-- ============================================================
ALTER TABLE public.tracked_entities ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

