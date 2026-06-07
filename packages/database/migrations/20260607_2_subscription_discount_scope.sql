-- Migration: Add default subscription_discount_scope to system_config
INSERT INTO public.system_config (key, value, updated_at)
VALUES ('subscription_discount_scope', '"all_months"', now())
ON CONFLICT (key) DO NOTHING;
