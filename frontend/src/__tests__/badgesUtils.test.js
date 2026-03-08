import { describe, it, expect } from 'vitest';
import { getRarityInfo, calculateTotalXP, getLevelFromXP, getNextLevelXP } from '../config/badges.js';

describe('badge utilities', () => {
  it('returns correct rarity info', () => {
    const common = getRarityInfo('COMMON');
    expect(common.name).toBe('Common');
    const non = getRarityInfo('NONEXISTENT');
    expect(non.name).toBe('Common');
  });

  it('calculates XP and levels', () => {
    const badges = [
      { rarity: 'COMMON', xp: 10 },
      { rarity: 'RARE', xp: 50 },
    ];
    expect(calculateTotalXP(badges)).toBe(60);
    expect(getLevelFromXP(0)).toBe(1);
    expect(getLevelFromXP(100)).toBe(2);
    expect(getNextLevelXP(150)).toBe(200);
  });
});