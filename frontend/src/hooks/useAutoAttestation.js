/**
 * useAutoAttestation hook
 *
 * Watches for badges that are:
 *   1. Eligible (user meets the off-chain criteria)
 *   2. On-chain (have a numeric onChainBadgeId)
 *   3. NOT yet allowlisted (not yet added to the smart-contract allowlist)
 *   4. NOT a min_balance badge (those skip the allowlist entirely)
 *
 * For every such badge it calls POST /api/badges/attest, which re-verifies
 * eligibility server-side and adds the user to the allowlist automatically.
 * The parent hook (useBadges) can then re-check the on-chain allowlist state
 * and surface the badge as "Claim Badge" to the user.
 *
 * Attestation is idempotent on the server – duplicate calls are safe and
 * the endpoint returns { alreadyAllowlisted: true } when the work is done.
 */
import { useEffect, useRef, useCallback } from 'react';

/**
 * @param {object} params
 * @param {string|null}  params.address          - Connected wallet address
 * @param {Array}        params.eligibleBadges   - Enriched badges with { id, onChainBadgeId, criteria, baseEligible, needsOnChainAttestation, onChainAllowlisted }
 * @param {Function}     params.onAttested       - Called with (badgeId) after a successful attestation so parent can refresh allowlist state
 */
export default function useAutoAttestation({ address, eligibleBadges, onAttested }) {
  // Track badges currently being attested (prevent duplicate in-flight requests)
  const inflightRef = useRef(new Set());
  // Track badges that have already been attested this session
  const attestedRef = useRef(new Set());

  const attest = useCallback(
    async (badge) => {
      const key = `${String(address).toLowerCase()}:${badge.id}`;

      if (inflightRef.current.has(key) || attestedRef.current.has(key)) return;

      inflightRef.current.add(key);
      try {
        const res = await fetch('/api/badges/attest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, badgeId: badge.id }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.ok) {
          attestedRef.current.add(key);
          if (typeof onAttested === 'function') {
            onAttested(badge.id);
          }
        }
        // On non-2xx (e.g. 403 not eligible, 503 service issue) just log and move on.
        // The eligibility poller will retry naturally on the next interval.
        if (!res.ok) {
          const reason = data?.error || res.statusText;
          if (res.status !== 429) {
            // 429 is expected under heavy load; silence it. Everything else worth noting.
            console.debug(`[autoAttest] ${badge.id}: ${reason}`);
          }
        }
      } catch (err) {
        // Network error – will retry on next eligibility poll
        console.debug('[autoAttest] network error:', err.message);
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [address, onAttested]
  );

  useEffect(() => {
    if (!address || !Array.isArray(eligibleBadges)) return;

    for (const badge of eligibleBadges) {
      // Only attest badges that:
      //  - are newly eligible in this render
      //  - need on-chain allowlist attestation
      //  - are not already allowlisted
      if (
        badge.baseEligible &&
        badge.needsOnChainAttestation &&
        !badge.onChainAllowlisted
      ) {
        attest(badge);
      }
    }
  }, [address, eligibleBadges, attest]);

  // Clear session cache when address changes
  useEffect(() => {
    attestedRef.current.clear();
    inflightRef.current.clear();
  }, [address]);
}
