-- =============================================================================
-- MIGRATION: Add Subscription Tier System
-- Replaces manual is_verified with subscription_tier (free/lite/pro)
-- =============================================================================

-- 1. Add subscription columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- 2. Add CHECK constraint for valid tiers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_subscription_tier'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT valid_subscription_tier
      CHECK (subscription_tier IN ('free', 'lite', 'pro'));
  END IF;
END $$;

-- 3. Migrate existing verified users to 'lite' tier
UPDATE public.profiles
SET subscription_tier = 'lite',
    subscription_started_at = NOW()
WHERE is_verified = true
  AND subscription_tier = 'free';

-- 4. Add index for admin queries on tier
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier
  ON public.profiles (subscription_tier);

-- 5. Log completion
DO $$ BEGIN
  RAISE NOTICE 'Subscription tier migration complete. Migrated verified users to lite tier.';
END $$;
