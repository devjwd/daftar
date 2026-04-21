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
  xp                bigint       NOT NULL DEFAULT 0, -- Upgraded to bigint for scalability
  edit_key_hash     text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

-- TABLE: badge_definitions
CREATE TABLE IF NOT EXISTS public.badge_definitions (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id            text         NOT NULL UNIQUE, -- Natural identifier
  name                text         NOT NULL,
  description         text         NOT NULL DEFAULT '',
  image_url           text         NOT NULL DEFAULT '',
  xp_value            bigint       NOT NULL DEFAULT 0, -- Upgraded to bigint
  mint_fee            numeric      NOT NULL DEFAULT 0,
  category            text,
  criteria            jsonb        NOT NULL DEFAULT '[]',
  metadata            jsonb        NOT NULL DEFAULT '{}',
  is_public           boolean      NOT NULL DEFAULT true,
  enabled             boolean      NOT NULL DEFAULT true,
  is_active           boolean      NOT NULL DEFAULT true,
  rule_type           text         DEFAULT 'manual',
  rule_params         jsonb        NOT NULL DEFAULT '{}',
  on_chain_badge_id   integer,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- TABLE: badge_attestations
CREATE TABLE IF NOT EXISTS public.badge_attestations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text         NOT NULL REFERENCES public.profiles(wallet_address) ON DELETE CASCADE,
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

-- TABLE: badge_eligible_wallets (Allowlist)
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
  category         text DEFAULT 'Protocol', -- e.g. 'Treasury', 'Dex', 'Bridge'
  logo_url         text,
  website_url      text,
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
CREATE INDEX IF NOT EXISTS idx_profiles_xp_desc ON public.profiles (xp DESC, created_at ASC);

-- Badge Visibility
CREATE INDEX IF NOT EXISTS idx_badge_eligibility_lookup ON public.badge_eligible_wallets (wallet_address, badge_id);
CREATE INDEX IF NOT EXISTS idx_badge_definitions_enabled ON public.badge_definitions (enabled) WHERE enabled = true;

-- Transaction History
CREATE INDEX IF NOT EXISTS idx_txs_wallet_ts ON public.transaction_history (wallet_address, tx_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_end ON public.api_rate_limits (window_end);

-- ----------------------------------------------------------------------------
-- 5. RLS & POLICIES
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

-- Dynamic Policy Refresh
DO $$ 
BEGIN
    -- Cleanup legacy policies
    DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Public read badge definitions" ON public.badge_definitions;
    DROP POLICY IF EXISTS "Public read attestations" ON public.badge_attestations;
    DROP POLICY IF EXISTS "Public read transactions" ON public.transaction_history;
    DROP POLICY IF EXISTS "Public read prices" ON public.price_cache;
    DROP POLICY IF EXISTS "Public read swap stats" ON public.dapp_swap_stats;
    DROP POLICY IF EXISTS "Public read entities" ON public.tracked_entities;
    DROP POLICY IF EXISTS "Allow anon select eligibility" ON public.badge_eligible_wallets;
    DROP POLICY IF EXISTS "Service role manage all" ON public.badge_eligible_wallets;
    
    -- Service role standard policies (Ensure names match CREATE blocks below)
    DROP POLICY IF EXISTS "Service role write profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Service role full access profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Service role manage badge definitions" ON public.badge_definitions;
    DROP POLICY IF EXISTS "Service role full access badges" ON public.badge_definitions;
    DROP POLICY IF EXISTS "Service role manage attestations" ON public.badge_attestations;
    DROP POLICY IF EXISTS "Service role full access attestations" ON public.badge_attestations;
    DROP POLICY IF EXISTS "Service role full access nonces" ON public.used_nonces;
    DROP POLICY IF EXISTS "Service role full access rates" ON public.api_rate_limits;
    DROP POLICY IF EXISTS "Service role full access entities" ON public.tracked_entities;
END $$;

-- Public Access (Read Only)
CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read badge definitions" ON public.badge_definitions FOR SELECT TO anon, authenticated USING (is_public = true AND enabled = true);
CREATE POLICY "Public read attestations" ON public.badge_attestations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read transactions" ON public.transaction_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read prices" ON public.price_cache FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read swap stats" ON public.dapp_swap_stats FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read entities" ON public.tracked_entities FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon select eligibility" ON public.badge_eligible_wallets FOR SELECT TO anon, authenticated USING (true);

-- Authenticated Admin Management for Entities
CREATE POLICY "Authenticated manage entities" ON public.tracked_entities FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Admin Access (Full Control)
CREATE POLICY "Service role manage all" ON public.badge_eligible_wallets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access profiles" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access badges" ON public.badge_definitions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access attestations" ON public.badge_attestations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access nonces" ON public.used_nonces FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access rates" ON public.api_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access entities" ON public.tracked_entities FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 6. XP & UPDATED_AT TRIGGERS
-- ----------------------------------------------------------------------------

-- Award Trade XP Function
CREATE OR REPLACE FUNCTION public.sync_trade_xp()
RETURNS TRIGGER AS $$
DECLARE
  v_volume numeric;
  v_xp_reward bigint := 0;
BEGIN
  -- Only process successful Daftar swaps
  IF (NEW.source != 'daftar_swap' OR NEW.status != 'success') THEN
    RETURN NEW;
  END IF;

  -- Use average of in/out as volume benchmark
  v_volume := (COALESCE(NEW.amount_in_usd, 0) + COALESCE(NEW.amount_out_usd, 0)) / 2;
  
  -- Logic: 1 XP per $5 volume
  v_xp_reward := FLOOR(v_volume / 5);

  -- Bonuses: +50 for $500+, +5 for $100+
  IF v_volume >= 500 THEN
    v_xp_reward := v_xp_reward + 50;
  ELSIF v_volume >= 100 THEN
    v_xp_reward := v_xp_reward + 5;
  END IF;

  -- Ensure profile exists
  INSERT INTO public.profiles (wallet_address, xp)
  VALUES (NEW.wallet_address, 0)
  ON CONFLICT (wallet_address) DO NOTHING;

  -- Award XP
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
  -- Ensure profile exists (Ghost Profile pattern)
  INSERT INTO public.profiles (wallet_address, xp)
  VALUES (NEW.wallet_address, 0)
  ON CONFLICT (wallet_address) DO NOTHING;

  -- Get Badge XP Value
  SELECT xp_value INTO v_xp_val FROM public.badge_definitions WHERE badge_id = NEW.badge_id;

  -- Handle State Transitions
  IF (TG_OP = 'INSERT' AND NEW.eligible = true) OR (TG_OP = 'UPDATE' AND OLD.eligible = false AND NEW.eligible = true) THEN
    -- Award XP
    UPDATE public.profiles SET xp = xp + COALESCE(v_xp_val, 0), updated_at = now() WHERE wallet_address = NEW.wallet_address;
  ELSIF (TG_OP = 'UPDATE' AND OLD.eligible = true AND NEW.eligible = false) THEN
    -- Revoke XP
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

-- Trigger Activation
DROP TRIGGER IF EXISTS trg_badge_xp_sync ON public.badge_attestations;
CREATE TRIGGER trg_badge_xp_sync 
AFTER INSERT OR UPDATE ON public.badge_attestations 
FOR EACH ROW EXECUTE FUNCTION public.sync_user_xp();

DROP TRIGGER IF EXISTS trg_trade_xp_sync ON public.transaction_history;
CREATE TRIGGER trg_trade_xp_sync
AFTER INSERT ON public.transaction_history
FOR EACH ROW EXECUTE FUNCTION public.sync_trade_xp();

DROP TRIGGER IF EXISTS trg_badge_xp_revoke ON public.badge_attestations;
CREATE TRIGGER trg_badge_xp_revoke 
AFTER DELETE ON public.badge_attestations 
FOR EACH ROW EXECUTE FUNCTION public.revoke_user_xp_on_delete();

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
  $cron$);
END $$;

-- ----------------------------------------------------------------------------
-- 9. SEED DATA (Starter Badges)
-- ----------------------------------------------------------------------------
INSERT INTO public.badge_definitions (badge_id, name, description, image_url, xp_value, category)
VALUES 
  ('early_adopter', 'Early Adopter', 'Joined Daftar during the Movement Network Testnet phase.', 'https://pzbtcftikbspixhcegfl.supabase.co/storage/v1/object/public/badges/early-adopter.png', 500, 'Activity'),
  ('movement_native', 'Movement Native', 'Interacted with native delegation and staking pools.', 'https://pzbtcftikbspixhcegfl.supabase.co/storage/v1/object/public/badges/movement-native.png', 1000, 'Staking'),
  ('portfolio_pro', 'Portfolio Pro', 'Maintained a net worth of over 10,000 MOVE.', 'https://pzbtcftikbspixhcegfl.supabase.co/storage/v1/object/public/badges/portfolio-pro.png', 2500, 'Wealth')
ON CONFLICT (badge_id) DO UPDATE SET
  category = EXCLUDED.category,
  xp_value = EXCLUDED.xp_value;
