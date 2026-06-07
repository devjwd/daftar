-- Migration: Add User Alert Configurations for Telegram, Discord and Email
-- Date: 2026-06-07

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

-- Setup RLS
ALTER TABLE public.user_alert_configs ENABLE ROW LEVEL SECURITY;

-- Dynamic Policy Refresh
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow all manage alert config" ON public.user_alert_configs;
    DROP POLICY IF EXISTS "Read for anon alert config" ON public.user_alert_configs;
END $$;

-- Policies for users and services
CREATE POLICY "Read for anon alert config" ON public.user_alert_configs FOR SELECT USING (true);
CREATE POLICY "Service role full access on alert config" ON public.user_alert_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Base privileges setup
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.user_alert_configs TO anon;
GRANT ALL PRIVILEGES ON public.user_alert_configs TO authenticated, service_role;
