-- Migration: Add subscription_payments table for MOVE token payment tracking
-- This table serves as a payment ledger and prevents replay attacks
-- (each tx hash can only be used once to activate a subscription)

-- ─── subscription_payments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  tx_hash        TEXT NOT NULL UNIQUE,
  amount_octas   BIGINT NOT NULL,
  price_usd      NUMERIC(12, 4) NOT NULL,
  move_price_usd NUMERIC(12, 6) NOT NULL,
  duration_days  INTEGER NOT NULL DEFAULT 30,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookup by wallet
CREATE INDEX IF NOT EXISTS idx_subscription_payments_wallet
  ON public.subscription_payments (wallet_address);

-- Index for tx hash uniqueness check (already covered by UNIQUE constraint, but explicit for visibility)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_tx_hash
  ON public.subscription_payments (tx_hash);

-- ─── RLS Policies ──────────────────────────────────────────────────────────

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Service role has full access (server-side writes)
CREATE POLICY "Service role full access on subscription_payments"
  ON public.subscription_payments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own payment records
CREATE POLICY "Users read own subscription_payments"
  ON public.subscription_payments
  FOR SELECT
  TO authenticated
  USING (wallet_address = lower(auth.jwt() ->> 'sub'));

-- Anonymous users cannot read payment records
CREATE POLICY "Anon no access subscription_payments"
  ON public.subscription_payments
  FOR SELECT
  TO anon
  USING (false);
