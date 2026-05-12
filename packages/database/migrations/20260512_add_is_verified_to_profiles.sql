-- Migration: Add is_verified to profiles
-- Created: 2026-05-12

-- Add the is_verified column with a default value of false
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Add a comment for clarity
COMMENT ON COLUMN public.profiles.is_verified IS 'Indicates if the user has been verified by an administrator.';

-- Create an index for performance if we plan to filter by verified status often
CREATE INDEX IF NOT EXISTS idx_profiles_is_verified ON public.profiles (is_verified) WHERE is_verified = true;
