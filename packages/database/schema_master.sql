-- =============================================================================
-- MOVEMENT NETWORK PORTFOLIO MANAGER — PRODUCTION MASTER SCHEMA (CONSOLIDATED)
-- Includes: Base Schema, Migrations, Analytics Enriched Tables, and Sync Queue
-- Run this entire script in your Supabase SQL Editor to set up everything.
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
-- 3. TABLES DEFINITIONS
-- ----------------------------------------------------------------------------

-- TABLE: profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address      text         NOT NULL UNIQUE,
  username            text,
  bio                 text,
  twitter             text,
  telegram            text,
  avatar_url          text,
  xp                  bigint       NOT NULL DEFAULT 0,
  edit_key_hash       text,
  is_verified         boolean      NOT NULL DEFAULT false,
  pnl_baseline_at     timestamptz,
  pnl_baseline_value  numeric      DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- TABLE: badge_definitions
CREATE TABLE IF NOT EXISTS public.badge_definitions (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id            text         NOT NULL UNIQUE,
  name                text         NOT NULL,
  description         text         NOT NULL DEFAULT '',
  image_url           text         NOT NULL DEFAULT '',
  xp_value            bigint       NOT NULL DEFAULT 0,
  mint_fee            numeric      NOT NULL DEFAULT 0,
  category            text,
  criteria            jsonb        NOT NULL DEFAULT '[]',
  metadata            jsonb        NOT NULL DEFAULT '{}',
  is_public           boolean      NOT NULL DEFAULT true,
  enabled             boolean      NOT NULL DEFAULT true,
  is_active           boolean      NOT NULL DEFAULT true,
  is_deleted          boolean      NOT NULL DEFAULT false,
  rule_type           text         DEFAULT 'manual',
  rule_params         jsonb        NOT NULL DEFAULT '{}',
  on_chain_badge_id   integer,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- TABLE: badge_attestations
CREATE TABLE IF NOT EXISTS public.badge_attestations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text         NOT NULL REFERENCES public.profiles(wallet_address) ON DELETE RESTRICT,
  badge_id        text         NOT NULL REFERENCES public.badge_definitions(badge_id) ON DELETE CASCADE,
  eligible        boolean      NOT NULL DEFAULT false,
  proof_hash      text,
  metadata        jsonb        NOT NULL DEFAULT '{}',
  verified_at     timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_attestation UNIQUE (wallet_address, badge_id),
  CONSTRAINT proof_required_when_eligible CHECK (eligible = false OR proof_hash IS NOT NULL)
);

-- TABLE: badge_eligible_wallets
CREATE TABLE IF NOT EXISTS public.badge_eligible_wallets (
    badge_id        text         REFERENCES public.badge_definitions(badge_id) ON DELETE CASCADE,
    wallet_address  text         NOT NULL,
    created_at      timestamptz  DEFAULT now(),
    PRIMARY KEY (badge_id, wallet_address)
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

-- TABLE: transaction_history (Base Table)
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
  category         text DEFAULT 'Protocol',
  logo_url         text,
  website_url      text,
  twitter_url      text,
  custom_type      text,
  badge_color      text,
  is_verified      boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- TABLE: address_labels
CREATE TABLE IF NOT EXISTS public.address_labels (
    address TEXT PRIMARY KEY,
    label_name TEXT NOT NULL,
    entity_id UUID REFERENCES public.tracked_entities(id) ON DELETE SET NULL,
    confidence_score FLOAT DEFAULT 1.0,
    discovery_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLE: nft_collection_stats
CREATE TABLE IF NOT EXISTS public.nft_collection_stats (
  collection_id    text         PRIMARY KEY,
  name             text,
  floor_price      numeric      NOT NULL DEFAULT 0,
  top_bid          numeric      NOT NULL DEFAULT 0,
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- TABLE: token_price_history (Historical Price Feed)
CREATE TABLE IF NOT EXISTS public.token_price_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address   text         NOT NULL,
  price           numeric      NOT NULL,
  timestamp       timestamptz  NOT NULL,
  granularity     text         NOT NULL DEFAULT 'daily',
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(token_address, timestamp)
);

-- TABLE: user_balance_snapshots (Reconstruction States)
CREATE TABLE IF NOT EXISTS public.user_balance_snapshots (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address    text         NOT NULL,
  asset_type      text         NOT NULL,
  symbol          text,
  amount          numeric      NOT NULL,
  snapshot_date   date         NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(user_address, asset_type, snapshot_date)
);

-- TABLE: user_networth_snapshots
CREATE TABLE IF NOT EXISTS public.user_networth_snapshots (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address        text         NOT NULL,
  total_networth_usd  numeric      NOT NULL DEFAULT 0,
  wallet_usd          numeric      NOT NULL DEFAULT 0,
  defi_usd            numeric      NOT NULL DEFAULT 0,
  nft_usd             numeric      NOT NULL DEFAULT 0,
  net_deposits_usd    numeric      NOT NULL DEFAULT 0,
  breakdown           jsonb        NOT NULL DEFAULT '{}',
  timestamp           timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(user_address, timestamp)
);

-- TABLE: user_transaction_history (Enriched History for Analytics View)
CREATE TABLE IF NOT EXISTS public.user_transaction_history (
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

-- TABLE: user_sync_status (Analytics Pipeline Status Tracking)
CREATE TABLE IF NOT EXISTS public.user_sync_status (
    user_address TEXT PRIMARY KEY,
    last_synced_version TEXT DEFAULT '0',
    full_history_synced BOOLEAN DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    sync_error TEXT,
    total_transactions INTEGER DEFAULT 0,
    synced_transactions INTEGER DEFAULT 0
);

-- TABLE: sync_queue (Queue Worker serialization table)
CREATE TABLE IF NOT EXISTS public.sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABLE: subscription_tiers
CREATE TABLE IF NOT EXISTS public.subscription_tiers (
    tier_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    price_usd     NUMERIC NOT NULL DEFAULT 0,
    features      JSONB NOT NULL DEFAULT '[]',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- TABLE: subscription_codes
CREATE TABLE IF NOT EXISTS public.subscription_codes (
    code          TEXT PRIMARY KEY,
    tier_id       TEXT NOT NULL REFERENCES public.subscription_tiers(tier_id),
    duration_days INTEGER NOT NULL DEFAULT 30,
    max_uses      INTEGER NOT NULL DEFAULT 1,
    times_used    INTEGER NOT NULL DEFAULT 0,
    expires_at    TIMESTAMPTZ,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- TABLE: user_subscriptions
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL REFERENCES public.profiles(wallet_address) ON DELETE CASCADE,
    tier_id        TEXT NOT NULL REFERENCES public.subscription_tiers(tier_id),
    status         TEXT NOT NULL DEFAULT 'active',
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ,
    auto_renew     BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- ----------------------------------------------------------------------------
-- 4. INDEXES DEFINITIONS
-- ----------------------------------------------------------------------------
-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_wallet ON public.profiles (wallet_address);
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm ON public.profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_trgm ON public.profiles USING gin (wallet_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_xp_desc ON public.profiles (xp DESC, created_at ASC);

-- subscriptions
CREATE INDEX IF NOT EXISTS idx_subscription_codes_code ON public.subscription_codes (code);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_wallet ON public.user_subscriptions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tier ON public.user_subscriptions (tier_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions (status);

-- badge_definitions & attestations
CREATE INDEX IF NOT EXISTS idx_badge_eligibility_lookup ON public.badge_eligible_wallets (wallet_address, badge_id);
CREATE INDEX IF NOT EXISTS idx_badge_definitions_enabled ON public.badge_definitions (enabled) WHERE enabled = true;

-- transaction_history & rate limits
CREATE INDEX IF NOT EXISTS idx_txs_wallet_ts ON public.transaction_history (wallet_address, tx_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_end ON public.api_rate_limits (window_end);

-- address_labels
CREATE INDEX IF NOT EXISTS idx_address_labels_entity_id ON public.address_labels(entity_id);

-- user_balance_snapshots & token_price_history
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_user_date ON public.user_balance_snapshots (user_address, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_asset ON public.user_balance_snapshots (asset_type);
CREATE INDEX IF NOT EXISTS idx_price_history_token_ts ON public.token_price_history (token_address, timestamp DESC);

-- user_networth_snapshots
CREATE INDEX IF NOT EXISTS idx_networth_snapshots_user_ts ON public.user_networth_snapshots (user_address, timestamp DESC);

-- user_transaction_history
CREATE INDEX IF NOT EXISTS idx_user_tx_address_time ON public.user_transaction_history(user_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_tx_protocol ON public.user_transaction_history(user_address, protocol);
CREATE INDEX IF NOT EXISTS idx_user_tx_action ON public.user_transaction_history(user_address, action);

-- sync_queue
CREATE INDEX IF NOT EXISTS idx_sync_queue_lookup ON public.sync_queue(status, priority DESC, created_at ASC);

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_eligible_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dapp_swap_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.address_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nft_collection_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_networth_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

-- Clean legacy policies
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Read for anon profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Read for anon badge definitions" ON public.badge_definitions;
    DROP POLICY IF EXISTS "Read for anon attestations" ON public.badge_attestations;
    DROP POLICY IF EXISTS "Read for anon transactions" ON public.transaction_history;
    DROP POLICY IF EXISTS "Read for anon prices" ON public.price_cache;
    DROP POLICY IF EXISTS "Read for anon swap stats" ON public.dapp_swap_stats;
    DROP POLICY IF EXISTS "Read for anon entities" ON public.tracked_entities;
    DROP POLICY IF EXISTS "Read for anon eligibility" ON public.badge_eligible_wallets;
    DROP POLICY IF EXISTS "Public read access for address_labels" ON public.address_labels;
    DROP POLICY IF EXISTS "Admin full access for address_labels" ON public.address_labels;
    DROP POLICY IF EXISTS "Read for anon nft_stats" ON public.nft_collection_stats;
    DROP POLICY IF EXISTS "Public read balance snapshots" ON public.user_balance_snapshots;
    DROP POLICY IF EXISTS "Public read token price history" ON public.token_price_history;
    DROP POLICY IF EXISTS "Read for anon networth snapshots" ON public.user_networth_snapshots;
    DROP POLICY IF EXISTS "Public sync status read" ON public.user_sync_status;
    DROP POLICY IF EXISTS "Service role can manage sync status" ON public.user_sync_status;
    DROP POLICY IF EXISTS "Public sync queue read" ON public.sync_queue;
    DROP POLICY IF EXISTS "Service role can manage sync queue" ON public.sync_queue;
END $$;

-- Policy creation (Read-only for anon, full access is granted to authenticated/service_role via standard SQL grants)
CREATE POLICY "Read for anon profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Read for anon badge definitions" ON public.badge_definitions FOR SELECT USING (true);
CREATE POLICY "Read for anon attestations" ON public.badge_attestations FOR SELECT USING (true);
CREATE POLICY "Read for anon transactions" ON public.transaction_history FOR SELECT USING (true);
CREATE POLICY "Read for anon prices" ON public.price_cache FOR SELECT USING (true);
CREATE POLICY "Read for anon swap stats" ON public.dapp_swap_stats FOR SELECT USING (true);
CREATE POLICY "Read for anon entities" ON public.tracked_entities FOR SELECT USING (true);
CREATE POLICY "Read for anon eligibility" ON public.badge_eligible_wallets FOR SELECT USING (true);
CREATE POLICY "Public read access for address_labels" ON public.address_labels FOR SELECT USING (true);
CREATE POLICY "Admin full access for address_labels" ON public.address_labels FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Read for anon nft_stats" ON public.nft_collection_stats FOR SELECT USING (true);
CREATE POLICY "Public read balance snapshots" ON public.user_balance_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read token price history" ON public.token_price_history FOR SELECT USING (true);
CREATE POLICY "Read for anon networth snapshots" ON public.user_networth_snapshots FOR SELECT USING (true);
CREATE POLICY "Public sync status read" ON public.user_sync_status FOR SELECT USING (true);
CREATE POLICY "Service role can manage sync status" ON public.user_sync_status FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public sync queue read" ON public.sync_queue FOR SELECT USING (true);
CREATE POLICY "Service role can manage sync queue" ON public.sync_queue FOR ALL USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 6. TRIGGERS DEFINITIONS
-- ----------------------------------------------------------------------------

-- Award Trade XP Function
CREATE OR REPLACE FUNCTION public.sync_trade_xp()
RETURNS TRIGGER AS $$
DECLARE
  v_volume numeric;
  v_xp_reward bigint := 0;
BEGIN
  IF (NEW.source != 'daftar_swap' OR NEW.status != 'success') THEN
    RETURN NEW;
  END IF;

  v_volume := (COALESCE(NEW.amount_in_usd, 0) + COALESCE(NEW.amount_out_usd, 0)) / 2;
  v_xp_reward := FLOOR(v_volume / 5);

  IF v_volume >= 500 THEN
    v_xp_reward := v_xp_reward + 50;
  ELSIF v_volume >= 100 THEN
    v_xp_reward := v_xp_reward + 5;
  END IF;

  INSERT INTO public.profiles (wallet_address, xp)
  VALUES (NEW.wallet_address, 0)
  ON CONFLICT (wallet_address) DO NOTHING;

  IF v_xp_reward > 0 THEN
    UPDATE public.profiles 
    SET xp = xp + v_xp_reward, 
        updated_at = now() 
    WHERE wallet_address = NEW.wallet_address;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Award/Update Badge XP Function
CREATE OR REPLACE FUNCTION public.sync_user_xp()
RETURNS TRIGGER AS $$
DECLARE v_xp_val bigint;
BEGIN
  INSERT INTO public.profiles (wallet_address, xp)
  VALUES (NEW.wallet_address, 0)
  ON CONFLICT (wallet_address) DO NOTHING;

  SELECT xp_value INTO v_xp_val FROM public.badge_definitions WHERE badge_id = NEW.badge_id;

  IF (TG_OP = 'INSERT' AND NEW.eligible = true AND NEW.proof_hash IS NOT NULL) OR 
     (TG_OP = 'UPDATE' AND OLD.proof_hash IS NULL AND NEW.proof_hash IS NOT NULL AND NEW.eligible = true) THEN
    UPDATE public.profiles SET xp = xp + COALESCE(v_xp_val, 0), updated_at = now() WHERE wallet_address = NEW.wallet_address;
  ELSIF (TG_OP = 'UPDATE' AND OLD.proof_hash IS NOT NULL AND NEW.eligible = false) THEN
    UPDATE public.profiles SET xp = GREATEST(0, xp - COALESCE(v_xp_val, 0)), updated_at = now() WHERE wallet_address = NEW.wallet_address;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Revoke XP on Delete
CREATE OR REPLACE FUNCTION public.revoke_user_xp_on_delete()
RETURNS TRIGGER AS $$
DECLARE v_xp_val bigint;
BEGIN
  SELECT xp_value INTO v_xp_val FROM public.badge_definitions WHERE badge_id = OLD.badge_id;
  IF OLD.eligible = true THEN
    UPDATE public.profiles SET xp = GREATEST(0, xp - COALESCE(v_xp_val, 0)), updated_at = now() WHERE wallet_address = OLD.wallet_address;
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

-- Trigger Activations
DROP TRIGGER IF EXISTS trg_badge_xp_sync ON public.badge_attestations;
CREATE TRIGGER trg_badge_xp_sync AFTER INSERT OR UPDATE ON public.badge_attestations FOR EACH ROW EXECUTE FUNCTION public.sync_user_xp();

DROP TRIGGER IF EXISTS trg_trade_xp_sync ON public.transaction_history;
CREATE TRIGGER trg_trade_xp_sync AFTER INSERT ON public.transaction_history FOR EACH ROW EXECUTE FUNCTION public.sync_trade_xp();

DROP TRIGGER IF EXISTS trg_badge_xp_revoke ON public.badge_attestations;
CREATE TRIGGER trg_badge_xp_revoke AFTER DELETE ON public.badge_attestations FOR EACH ROW EXECUTE FUNCTION public.revoke_user_xp_on_delete();

-- Updated_at Timestamps
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_badge_definitions_updated_at ON public.badge_definitions;
CREATE TRIGGER trg_badge_definitions_updated_at BEFORE UPDATE ON public.badge_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_badge_attestations_updated_at ON public.badge_attestations;
CREATE TRIGGER trg_badge_attestations_updated_at BEFORE UPDATE ON public.badge_attestations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_api_rate_limits_updated_at ON public.api_rate_limits;
CREATE TRIGGER trg_api_rate_limits_updated_at BEFORE UPDATE ON public.api_rate_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tracked_entities_updated_at ON public.tracked_entities;
CREATE TRIGGER trg_tracked_entities_updated_at BEFORE UPDATE ON public.tracked_entities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_nft_collection_stats_updated_at ON public.nft_collection_stats;
CREATE TRIGGER trg_nft_collection_stats_updated_at BEFORE UPDATE ON public.nft_collection_stats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. PL/PGSQL FUNCTIONS (Rate Limiter & RPCs)
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

CREATE OR REPLACE FUNCTION public.increment_user_xp(user_addr text, amount bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (wallet_address, xp)
  VALUES (lower(user_addr), amount)
  ON CONFLICT (wallet_address)
  DO UPDATE SET xp = profiles.xp + amount, updated_at = now();
END; $$;

GRANT EXECUTE ON FUNCTION public.count_active_days TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_snapshots TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_snapshots_bulk TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_xp TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. SCHEDULED JOBS (pg_cron)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM cron.schedule('cleanup-api-rate-limits', '*/5 * * * *', 'DELETE FROM public.api_rate_limits WHERE window_end < now()');
  PERFORM cron.schedule('cleanup-expired-nonces', '*/30 * * * *', 'DELETE FROM public.used_nonces WHERE expires_at < now()');
  PERFORM cron.schedule('cleanup-price-cache', '0 * * * *', 'DELETE FROM public.price_cache WHERE cached_at < now() - interval ''24 hours''');
  
  PERFORM cron.schedule('prune-stale-txs', '30 2 * * *', $cron$
      DELETE FROM public.transaction_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY wallet_address ORDER BY tx_timestamp DESC) AS rn
          FROM public.transaction_history
        ) t WHERE t.rn > 500
      )
  $cron$);

  PERFORM cron.schedule('prune-hourly-networth-snapshots', '0 3 * * *', $cron$
      SELECT public.prune_old_snapshots_bulk(3);
  $cron$);
END $$;

-- ----------------------------------------------------------------------------
-- 9. PRIVILEGES SETUP
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. RETROACTIVE XP MIGRATION
-- ----------------------------------------------------------------------------
DO $$ 
DECLARE
    r RECORD;
    v_xp_reward bigint;
    v_volume numeric;
BEGIN
    RAISE NOTICE 'Starting Retroactive XP Migration...';
    FOR r IN 
        SELECT wallet_address, amount_in_usd, amount_out_usd 
        FROM public.transaction_history 
        WHERE source = 'daftar_swap' AND status = 'success' 
    LOOP
        v_volume := (COALESCE(r.amount_in_usd, 0) + COALESCE(r.amount_out_usd, 0)) / 2;
        v_xp_reward := FLOOR(v_volume / 5);

        IF v_volume >= 500 THEN
            v_xp_reward := v_xp_reward + 50;
        ELSIF v_volume >= 100 THEN
            v_xp_reward := v_xp_reward + 5;
        END IF;

        IF v_xp_reward > 0 THEN
            INSERT INTO public.profiles (wallet_address, xp) 
            VALUES (r.wallet_address, v_xp_reward)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET xp = public.profiles.xp + v_xp_reward, updated_at = now();
        END IF;
    END LOOP;
    RAISE NOTICE 'Retroactive XP Migration Complete.';
END $$;

-- 11. DYNAMIC CONFIGURATION MIGRATION
ALTER TABLE public.tracked_entities ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

