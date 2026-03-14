import { describe, expect, it } from 'vitest';
import { isBadgeEarned, shouldEvaluateBadgeEligibility } from '../hooks/useBadges.js';

describe('useBadges reconciliation logic', () => {
  it('treats badge as earned when local store has award', () => {
    const earnedIds = new Set(['badge_local']);
    const onChainMap = new Map();

    expect(isBadgeEarned('badge_local', earnedIds, onChainMap)).toBe(true);
  });

  it('treats badge as earned when on-chain map confirms ownership', () => {
    const earnedIds = new Set();
    const onChainMap = new Map([['badge_chain', true]]);

    expect(isBadgeEarned('badge_chain', earnedIds, onChainMap)).toBe(true);
  });

  it('skips eligibility evaluation for already earned badges', () => {
    const badge = { id: 'badge_chain' };
    const earnedIds = new Set();
    const onChainMap = new Map([['badge_chain', true]]);

    expect(shouldEvaluateBadgeEligibility(badge, earnedIds, onChainMap)).toBe(false);
  });

  it('evaluates eligibility for badges not earned anywhere', () => {
    const badge = { id: 'badge_new' };
    const earnedIds = new Set();
    const onChainMap = new Map([['badge_other', true]]);

    expect(shouldEvaluateBadgeEligibility(badge, earnedIds, onChainMap)).toBe(true);
  });
});
