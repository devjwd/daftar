-- =============================================================================
-- MOVEMENT NETWORK PORTFOLIO MANAGER — PRODUCTION MASTER SCHEMA (FINAL HARDENED)
-- Consolidated & Hardened: 2026-04-20
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_cron";    -- scheduled cleanup jobs
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram substring search support

-- ----------------------------------------------------------------------------
-- 2. UTILITY FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. TABLES
-- ----------------------------------------------------------------------------

-- TABLE: profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address    text         NOT NULL UNIQUE,
  username          text,
  bio               text,
  twitter           text,
  telegram          text,
  avatar_url        text,
  edit_key_hash     text,
  is_verified       boolean      NOT NULL DEFAULT false,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- TABLE: used_nonces
CREATE TABLE IF NOT EXISTS public.used_nonces (
  wallet_address  text         NOT NULL,
  nonce           text         NOT NULL,
  expires_at      timestamptz  NOT NULL,
  PRIMARY KEY (wallet_address, nonce)
);

-- TABLE: api_rate_limits
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key            text         NOT NULL,
  window_start   timestamptz  NOT NULL,
  window_end     timestamptz  NOT NULL,
  count          integer      NOT NULL DEFAULT 1,
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (key, window_start)
);

-- TABLE: price_cache
CREATE TABLE IF NOT EXISTS public.price_cache (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id    text         NOT NULL UNIQUE,
  price_usd   numeric      NOT NULL,
  change_24h  numeric,
  cached_at   timestamptz  NOT NULL DEFAULT now()
);

-- TABLE: transaction_history
CREATE TABLE IF NOT EXISTS public.transaction_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text         NOT NULL,
  tx_hash         text         NOT NULL UNIQUE,
  tx_type         text         NOT NULL,
  dapp_key        text,
  dapp_name       text,
  dapp_logo       text,
  dapp_website    text,
  dapp_contract   text,
  token_in        text,
  token_out       text,
  amount_in       numeric,
  amount_out      numeric,
  amount_in_usd   numeric,
  amount_out_usd  numeric,
  pnl_usd         numeric,
  gas_fee         numeric,
  status          text         NOT NULL DEFAULT 'success',
  source          text         NOT NULL DEFAULT 'indexer',
  tx_timestamp    timestamptz  NOT NULL,
  fetched_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- TABLE: dapp_swap_stats
CREATE TABLE IF NOT EXISTS public.dapp_swap_stats (
  wallet_address   text         NOT NULL PRIMARY KEY,
  total_swaps      integer      NOT NULL DEFAULT 0,
  total_volume_usd numeric      NOT NULL DEFAULT 0,
  last_swap_at     timestamptz,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- TABLE: tracked_entities
CREATE TABLE IF NOT EXISTS public.tracked_entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address          text NOT NULL UNIQUE,
  name             text NOT NULL,
  category         text DEFAULT 'Protocol', -- e.g. 'Treasury', 'Dex', 'Bridge', 'Airdrop'
  logo_url         text,
  website_url      text,
  twitter_url      text,
  custom_type      text, -- e.g. 'CASHBACK', 'REWARD', 'MINT'
  badge_color      text, -- Custom HEX or color name
  is_verified      boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. INDEXES
-- ----------------------------------------------------------------------------
-- Search & Lookup
CREATE INDEX IF NOT EXISTS idx_profiles_wallet  ON public.profiles (wallet_address);
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm ON public.profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_trgm   ON public.profiles USING gin (wallet_address gin_trgm_ops);

-- Transaction History
CREATE INDEX IF NOT EXISTS idx_txs_wallet_ts ON public.transaction_history (wallet_address, tx_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_end ON public.api_rate_limits (window_end);

-- ----------------------------------------------------------------------------
-- 5. RLS & POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dapp_swap_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_entities ENABLE ROW LEVEL SECURITY;

-- Dynamic Policy Refresh
DO $$ 
BEGIN
    -- Cleanup legacy policies
    DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Public read transactions" ON public.transaction_history;
    DROP POLICY IF EXISTS "Public read prices" ON public.price_cache;
    DROP POLICY IF EXISTS "Public read swap stats" ON public.dapp_swap_stats;
    DROP POLICY IF EXISTS "Public read entities" ON public.tracked_entities;
    
    -- Service role standard policies
    DROP POLICY IF EXISTS "Service role write profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Service role full access profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Service role full access nonces" ON public.used_nonces;
    DROP POLICY IF EXISTS "Service role full access rates" ON public.api_rate_limits;
    DROP POLICY IF EXISTS "Service role full access entities" ON public.tracked_entities;
    DROP POLICY IF EXISTS "Authenticated manage entities" ON public.tracked_entities;

    -- Cleanup universal policies if re-running
    DROP POLICY IF EXISTS "Allow all profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Allow all transactions" ON public.transaction_history;
    DROP POLICY IF EXISTS "Allow all prices" ON public.price_cache;
    DROP POLICY IF EXISTS "Allow all swap stats" ON public.dapp_swap_stats;
    DROP POLICY IF EXISTS "Allow all entities" ON public.tracked_entities;
    DROP POLICY IF EXISTS "Allow all nonces" ON public.used_nonces;
    DROP POLICY IF EXISTS "Allow all rates" ON public.api_rate_limits;

    -- Cleanup new secure policies
    DROP POLICY IF EXISTS "Read for anon profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Read for anon transactions" ON public.transaction_history;
    DROP POLICY IF EXISTS "Read for anon prices" ON public.price_cache;
    DROP POLICY IF EXISTS "Read for anon swap stats" ON public.dapp_swap_stats;
    DROP POLICY IF EXISTS "Read for anon entities" ON public.tracked_entities;
END $$;

-- Secure Access (Read-only for anon, full access is granted automatically to service_role)
CREATE POLICY "Read for anon profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Read for anon transactions" ON public.transaction_history FOR SELECT USING (true);
CREATE POLICY "Read for anon prices" ON public.price_cache FOR SELECT USING (true);
CREATE POLICY "Read for anon swap stats" ON public.dapp_swap_stats FOR SELECT USING (true);
CREATE POLICY "Read for anon entities" ON public.tracked_entities FOR SELECT USING (true);
-- used_nonces and api_rate_limits have NO read access for anon

-- ----------------------------------------------------------------------------
-- 6. TRIGGERS
-- ----------------------------------------------------------------------------

-- Updated_at Timestamps
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_api_rate_limits_updated_at ON public.api_rate_limits;
CREATE TRIGGER trg_api_rate_limits_updated_at BEFORE UPDATE ON public.api_rate_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tracked_entities_updated_at ON public.tracked_entities;
CREATE TRIGGER trg_tracked_entities_updated_at BEFORE UPDATE ON public.tracked_entities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. PL/PGSQL FUNCTIONS (Rate Limiter)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_api_rate_limit(p_key text, p_window_start timestamptz, p_window_ms integer)
RETURNS TABLE(count integer, reset_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY INSERT INTO public.api_rate_limits(key, window_start, window_end, count, updated_at)
  VALUES (p_key, date_trunc('milliseconds', p_window_start), p_window_start + (p_window_ms || ' milliseconds')::interval, 1, now())
  ON CONFLICT (key, window_start) DO UPDATE SET count = api_rate_limits.count + 1, updated_at = now()
  RETURNING api_rate_limits.count, api_rate_limits.window_end;
END; $$;

REVOKE ALL ON FUNCTION public.increment_api_rate_limit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_api_rate_limit TO service_role;

-- ----------------------------------------------------------------------------
-- 8. SCHEDULED JOBS (pg_cron)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM cron.schedule('cleanup-api-rate-limits', '*/5 * * * *', 'DELETE FROM public.api_rate_limits WHERE window_end < now()');
  PERFORM cron.schedule('cleanup-expired-nonces', '*/30 * * * *', 'DELETE FROM public.used_nonces WHERE expires_at < now()');
  PERFORM cron.schedule('cleanup-price-cache', '0 * * * *', 'DELETE FROM public.price_cache WHERE cached_at < now() - interval ''24 hours''');
  
  -- Prevent bloated tx history (Keep last 500 per wallet)
  PERFORM cron.schedule('prune-stale-txs', '30 2 * * *', $cron$
      DELETE FROM public.transaction_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY wallet_address ORDER BY tx_timestamp DESC) AS rn
          FROM public.transaction_history
        ) t WHERE t.rn > 500
      )
      AND wallet_address NOT IN (
        SELECT wallet_address FROM public.profiles WHERE subscription_tier = 'pro'
      )
  $cron$);
END $$;

-- ----------------------------------------------------------------------------
-- 8.5. ROLE PRIVILEGES (Fixing Permission Denied)
-- ----------------------------------------------------------------------------
-- Base PostgreSQL permissions are required BEFORE RLS policies are evaluated.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Restricted anon: SELECT only
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;

-- Make sure future tables automatically get these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8.6. RPC FUNCTIONS
-- ----------------------------------------------------------------------------

-- Function to count unique active days for a user
CREATE OR REPLACE FUNCTION public.count_active_days(user_addr text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (
    SELECT count(DISTINCT timestamp::date)
    FROM public.user_transaction_history
    WHERE user_address = lower(user_addr)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.prune_old_snapshots(user_addr text, days_to_keep integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.user_networth_snapshots
  WHERE user_address = lower(user_addr)
    AND timestamp < NOW() - (days_to_keep || ' days')::interval
    AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'UTC') != 23;
END; $$;

CREATE OR REPLACE FUNCTION public.prune_old_snapshots_bulk(days_to_keep integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.user_networth_snapshots
  WHERE timestamp < NOW() - (days_to_keep || ' days')::interval
    AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'UTC') != 23;
END; $$;

GRANT EXECUTE ON FUNCTION public.count_active_days TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_snapshots TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_snapshots_bulk TO anon, authenticated, service_role;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
