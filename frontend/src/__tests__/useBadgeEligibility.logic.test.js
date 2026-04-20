import { describe, expect, it } from 'vitest';
import { resolveEligibilityBadgeId } from '../hooks/useBadgeEligibility.js';

describe('useBadgeEligibility helpers', () => {
  it('prefers canonical definition ids from badge objects', () => {
    expect(resolveEligibilityBadgeId({ id: 'test-badge', onChainBadgeId: 7 })).toBe('test-badge');
  });

  it('normalizes raw numeric badge ids to strings', () => {
    expect(resolveEligibilityBadgeId(12)).toBe('12');
    expect(resolveEligibilityBadgeId('12')).toBe('12');
  });

  it('accepts published slug ids for frontend and backend lookups', () => {
    expect(resolveEligibilityBadgeId({ id: 'test-badge' })).toBe('test-badge');
    expect(resolveEligibilityBadgeId('test-badge')).toBe('test-badge');
  });

  it('returns null for empty values', () => {
    expect(resolveEligibilityBadgeId({})).toBeNull();
    expect(resolveEligibilityBadgeId('')).toBeNull();
    expect(resolveEligibilityBadgeId(null)).toBeNull();
  });
});