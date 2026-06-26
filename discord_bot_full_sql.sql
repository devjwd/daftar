-- ==========================================
-- DAFTAR DISCORD BOT FULL SQL CONFIGURATION
-- ==========================================

-- --------------------------------------------------------
-- 1. User Alert Configurations
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_alert_configs (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address      TEXT         NOT NULL UNIQUE REFERENCES public.profiles(wallet_address) ON DELETE CASCADE,
  
  -- Notification Channels
  email               TEXT,
  telegram_chat_id    TEXT,
  discord_user_id     TEXT,
  
  -- Active Channel Toggles
  email_enabled       BOOLEAN      DEFAULT FALSE,
  telegram_enabled    BOOLEAN      DEFAULT FALSE,
  discord_enabled     BOOLEAN      DEFAULT FALSE,
  
  -- Notification Filters
  min_amount_usd      NUMERIC      DEFAULT 0,
  alert_on_received   BOOLEAN      DEFAULT TRUE,
  alert_on_withdrawal BOOLEAN      DEFAULT TRUE,
  alert_on_swaps      BOOLEAN      DEFAULT FALSE,
  alert_on_failed     BOOLEAN      DEFAULT FALSE,
  
  created_at          TIMESTAMPTZ  DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
);

ALTER TABLE public.user_alert_configs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow all manage alert config" ON public.user_alert_configs;
    DROP POLICY IF EXISTS "Read for anon alert config" ON public.user_alert_configs;
    DROP POLICY IF EXISTS "Service role full access on alert config" ON public.user_alert_configs;
END $$;

CREATE POLICY "Read for anon alert config" ON public.user_alert_configs FOR SELECT USING (true);
CREATE POLICY "Service role full access on alert config" ON public.user_alert_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.user_alert_configs TO anon;
GRANT ALL PRIVILEGES ON public.user_alert_configs TO authenticated, service_role;


-- --------------------------------------------------------
-- 2. Discord Rate Limits
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS discord_rate_limits (
    user_id text PRIMARY KEY,
    last_request_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION check_discord_rate_limit(p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_allowed boolean;
BEGIN
    INSERT INTO discord_rate_limits (user_id, last_request_at)
    VALUES (p_user_id, now())
    ON CONFLICT (user_id) DO UPDATE 
    SET last_request_at = now()
    WHERE discord_rate_limits.last_request_at < now() - interval '2 seconds'
    RETURNING true INTO v_allowed;

    IF v_allowed IS NULL THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;


-- --------------------------------------------------------
-- 3. Price Alerts Config and Logs
-- --------------------------------------------------------
-- Add price alert configurations to user_alert_configs
ALTER TABLE public.user_alert_configs 
ADD COLUMN IF NOT EXISTS alert_on_price_change BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS price_alert_threshold DECIMAL DEFAULT 5.0;

-- Create price_alerts_log table to track cooldowns
CREATE TABLE IF NOT EXISTS public.price_alerts_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    last_alert_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_alert_price DECIMAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT fk_wallet FOREIGN KEY (wallet_address) REFERENCES public.profiles(wallet_address) ON DELETE CASCADE
);

ALTER TABLE public.price_alerts_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to price_alerts_log" ON public.price_alerts_log FOR SELECT USING (true);


-- --------------------------------------------------------
-- 4. Discord Guild Configs (Legacy / Optional)
-- Note: The bot now uses zero-config dynamic name matching 
-- ("Verified", "Pro", "modlogs", "Tickets"), but you can 
-- keep this table if you plan to reintroduce custom IDs.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_guild_configs (
    guild_id TEXT PRIMARY KEY,
    guild_name TEXT NOT NULL,
    verified_role_id TEXT,
    pro_role_id TEXT,
    modlogs_channel_id TEXT,
    support_category_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.discord_guild_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to discord_guild_configs" ON public.discord_guild_configs FOR SELECT USING (true);
