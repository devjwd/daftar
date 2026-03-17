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
 *
 * After MAX_RETRIES consecutive non-transient failures the badge is moved to
 * a "failed" set and onFailed is called so the UI can stop showing "Attesting…".
 */
import { useEffect, useRef, useCallback } from 'react';

const MAX_RETRIES = 3;

/**
 * @param {object} params
 * @param {string|null}  params.address          - Connected wallet address
 * @param {Array}        params.eligibleBadges   - Enriched badges with { id, onChainBadgeId, criteria, baseEligible, needsOnChainAttestation, onChainAllowlisted }
 * @param {Function}     params.onAttested       - Called with (badgeId) after a successful attestation so parent can refresh allowlist state
 * @param {Function}     [params.onFailed]       - Called with (badgeId) after MAX_RETRIES permanent failures so parent can mark attestation as failed
 */
export default function useAutoAttestation({ address, eligibleBadges, onAttested, onFailed }) {
  // Track badges currently being attested (prevent duplicate in-flight requests)
  const inflightRef = useRef(new Set());
  // Track badges that have already been attested (or permanently failed) this session
  const attestedRef = useRef(new Set());
  // Consecutive failure count per badge key
  const failuresRef = useRef(new Map());

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
          // Success – clear failure counter and mark as done
          failuresRef.current.delete(key);
          attestedRef.current.add(key);
          if (typeof onAttested === 'function') {
            onAttested(badge.id);
          }
          return;
        }

        // 429 is transient – don't count it against the retry budget
        if (res.status === 429) return;

        const reason = data?.error || res.statusText;
        const hint = data?.hint ? ` (hint: ${data.hint})` : '';
        if (res.status === 404 && data?.hint === 'publish_scanner_config') {
          // Only log this once — it won't resolve until the admin acts
          console.warn(`[autoAttest] ${badge.id}: scanner config not published yet. Open the Admin panel → Export → Scanner Config and publish it to enable auto-allowlist.`);
        } else {
          console.debug(`[autoAttest] ${badge.id}: ${reason}${hint}`);
        }

        const failures = (failuresRef.current.get(key) || 0) + 1;
        failuresRef.current.set(key, failures);

        if (failures >= MAX_RETRIES) {
          // Stop retrying – mark as permanently handled this session
          attestedRef.current.add(key);
          failuresRef.current.delete(key);
          if (typeof onFailed === 'function') {
            onFailed(badge.id);
          }
        }
      } catch (err) {
        // Network error – counts toward the retry budget
        console.debug('[autoAttest] network error:', err.message);
        const failures = (failuresRef.current.get(key) || 0) + 1;
        failuresRef.current.set(key, failures);
        if (failures >= MAX_RETRIES) {
          attestedRef.current.add(key);
          failuresRef.current.delete(key);
          if (typeof onFailed === 'function') {
            onFailed(badge.id);
          }
        }
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [address, onAttested, onFailed]
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
    failuresRef.current.clear();
  }, [address]);
}
