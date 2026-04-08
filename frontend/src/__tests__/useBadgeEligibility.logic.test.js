import { describe, expect, it } from 'vitest';
import { resolveEligibilityBadgeId } from '../hooks/useBadgeEligibility.js';

describe('useBadgeEligibility helpers', () => {
  it('prefers on-chain badge id from badge objects', () => {
    expect(resolveEligibilityBadgeId({ id: 'test-badge', onChainBadgeId: 7 })).toBe(7);
  });

  it('accepts raw numeric badge ids', () => {
    expect(resolveEligibilityBadgeId(12)).toBe(12);
    expect(resolveEligibilityBadgeId('12')).toBe(12);
  });

  it('returns null for frontend-only slug ids', () => {
    expect(resolveEligibilityBadgeId({ id: 'test-badge' })).toBeNull();
    expect(resolveEligibilityBadgeId('test-badge')).toBeNull();
  });
});