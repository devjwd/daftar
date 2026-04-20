import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_lib/indexerClient.js', () => ({
  queryIndexer: vi.fn(),
}));

import { queryIndexer } from '../../api/_lib/indexerClient.js';
import dappUsageAdapter from '../../api/_lib/badgeAdapters/dappUsage.js';
import protocolCountAdapter from '../../api/_lib/badgeAdapters/protocolCount.js';

describe('api badge adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dappUsage adapter reads direct GraphQL data shape', async () => {
    queryIndexer.mockResolvedValue({
      account_transactions: [{ transaction_version: 1 }, { transaction_version: 2 }],
    });

    const awards = await dappUsageAdapter.check('0xAbC', {
      badgeId: 'dapp-badge',
      dappAddress: '0xDAPP',
      minInteractions: 2,
      dappName: 'Demo dApp',
    });

    expect(queryIndexer).toHaveBeenCalledTimes(1);
    expect(awards).toHaveLength(1);
    expect(awards[0].badgeId).toBe('dapp-badge');
    expect(awards[0].extra.interactions).toBe(2);
  });

  it('protocolCount adapter reads direct GraphQL data shape', async () => {
    queryIndexer.mockResolvedValue({
      account_transactions: [
        { transaction: { payload: { function: '0x1::liquidswap::swap' } } },
        { transaction: { payload: { function: '0x2::custom_protocol::act' } } },
      ],
    });

    const awards = await protocolCountAdapter.check('0xabc', {
      badgeId: 'protocol-badge',
      minProtocols: 2,
    });

    expect(queryIndexer).toHaveBeenCalledTimes(1);
    expect(awards).toHaveLength(1);
    expect(awards[0].badgeId).toBe('protocol-badge');
    expect(awards[0].extra.protocolCount).toBe(2);
  });
});
