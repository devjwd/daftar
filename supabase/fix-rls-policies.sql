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