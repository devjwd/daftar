-- Lock down enriched transaction history from anonymous direct access.
-- Server uses service_role and is unaffected.

ALTER TABLE IF EXISTS public.user_transaction_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role manages user_transaction_history" ON public.user_transaction_history;
  DROP POLICY IF EXISTS "Deny anon read user_transaction_history" ON public.user_transaction_history;
END $$;

CREATE POLICY "Service role manages user_transaction_history"
  ON public.user_transaction_history
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.user_transaction_history FROM anon, authenticated;
GRANT ALL ON public.user_transaction_history TO service_role;
