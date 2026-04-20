import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock the indexer module functions used by adapters
vi.mock('../services/indexer.js', () => {
  return {
    checkAccountExists: vi.fn(),
    getWalletAge: vi.fn(),
    getUserTokenBalances: vi.fn(),
  };
});

import transactionCountAdapter from '../services/badgeAdapters/transactionCount.js';
import longevityAdapter from '../services/badgeAdapters/longevity.js';
import minBalanceAdapter from '../services/badgeAdapters/minBalance.js';
import { runAdaptersForAddress } from '../services/badgeAdapters/index.js';
import { BADGE_RULES } from '../config/badges.js';
import * as indexer from '../services/indexer.js';

describe('badge adapter unit tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('transactionCountAdapter awards correct tiers', async () => {
    indexer.checkAccountExists.mockResolvedValue({ txCount: 60 });
    const awards = await transactionCountAdapter.check('0xabc');
    expect(Array.isArray(awards)).toBe(true);
    // should include badges for tiers <=60
    expect(awards.some((a) => a.badgeId.includes('first-step'))).toBe(true);
    expect(awards.some((a) => a.badgeId.includes('power-user'))).toBe(true);
  });

  it('longevityAdapter computes days correctly', async () => {
    const now = Date.now();
    const weekAgo = new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString();
    indexer.getWalletAge.mockResolvedValue({ firstTxTimestamp: weekAgo });
    const awards = await longevityAdapter.check('0xabc');
    expect(awards.some((a) => a.badgeId.includes('7-day-pioneer'))).toBe(true);
  });

  it('minBalanceAdapter returns badge when balance meets threshold', async () => {
    indexer.getUserTokenBalances.mockResolvedValue([
      { coinType: '0x1::aptos_coin::AptosCoin', amount: '150' },
    ]);
    const rule = { coinType: '0x1::aptos_coin::AptosCoin', minBalance: 100, badgeId: 'aptos-holder' };
    const awards = await minBalanceAdapter.check('0xabc', null, rule);
    expect(awards.length).toBe(1);
    expect(awards[0].badgeId).toBe('aptos-holder');
  });

  it('runAdaptersForAddress respects badgeConfigs', async () => {
    indexer.checkAccountExists.mockResolvedValue({ txCount: 5 });
    indexer.getWalletAge.mockResolvedValue({ firstTxTimestamp: new Date().toISOString() });
    indexer.getUserTokenBalances.mockResolvedValue([]);

    const configs = [
      { badgeId: 'foo', rule: BADGE_RULES.TRANSACTION_COUNT, params: {} },
      { badgeId: 'bar', rule: BADGE_RULES.MIN_BALANCE, params: { coinType: 'x', minBalance: 1 } },
    ];
    const awards = await runAdaptersForAddress('0x123', configs);
    // transaction count adapter emits tier badge IDs, not config badgeId
    expect(awards.some((a) => a.badgeId === 'first-step')).toBe(true);
    // second config returns nothing
    expect(awards.some((a) => a.badgeId === 'bar')).toBe(false);
  });
});