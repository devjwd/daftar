-- RLS policy fixes for badge-related tables.

-- Needed by frontend/api/badges/eligibility.js:94 (getCachedAttestation)
DROP POLICY IF EXISTS "Anyone can read attestations" ON public.badge_attestations;
CREATE POLICY "Anyone can read attestations"
ON public.badge_attestations
FOR SELECT
TO anon, authenticated
USING (true);

COMMENT ON POLICY "Anyone can read attestations" ON public.badge_attestations
IS 'Needed by frontend/api/badges/eligibility.js:94 (getCachedAttestation)';

-- Needed by tracked address reads in the badge system state/admin flows.
DROP POLICY IF EXISTS "Authenticated users can read badge tracked addresses" ON public.badge_tracked_addresses;
CREATE POLICY "Authenticated users can read badge tracked addresses"
ON public.badge_tracked_addresses
FOR SELECT
TO authenticated
USING (true);

COMMENT ON POLICY "Authenticated users can read badge tracked addresses" ON public.badge_tracked_addresses
IS 'Needed by badge tracked address reads; requested from badge-system audit';

-- Needed by legacy badges-table reads during migration.
DROP POLICY IF EXISTS "Anyone can read badges" ON public.badges;
CREATE POLICY "Anyone can read badges"
ON public.badges
FOR SELECT
TO anon, authenticated
USING (true);

COMMENT ON POLICY "Anyone can read badges" ON public.badges
IS 'Needed by legacy badges-table reads during migration';

-- Backfill any legacy badge metadata rows into badge_definitions before badges usage is removed.
INSERT INTO badge_definitions (badge_id, name, description, image_url, rarity, xp_value)
SELECT id, name, description, image_url, rarity, xp_value
FROM badges
ON CONFLICT (badge_id) DO NOTHING;

-- Performance index for wallet history queries ordered by timestamp desc.
CREATE INDEX IF NOT EXISTS idx_txs_wallet_ts
	ON public.transaction_history(wallet_address, tx_timestamp DESC);

-- NOTE: Add this constraint directly in CREATE TABLE public.badge_attestations
-- in your canonical schema migration so fresh environments enforce it at creation time:
-- CONSTRAINT proof_required_when_eligible
--   CHECK (eligible = false OR proof_hash IS NOT NULL)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'proof_required_when_eligible'
			AND conrelid = 'public.badge_attestations'::regclass
	) THEN
		ALTER TABLE public.badge_attestations
			ADD CONSTRAINT proof_required_when_eligible
			CHECK (eligible = false OR proof_hash IS NOT NULL);
	END IF;
END $$;

-- Price cache TTL guidance:
-- Read paths should filter with: WHERE cached_at > now() - interval '1 hour'
-- Scheduled cleanup recommended (pg_cron):
-- DELETE FROM public.price_cache
-- WHERE cached_at < now() - interval '24 hours';