-- Add subscription_reminder_sent to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_reminder_sent BOOLEAN DEFAULT false;
