import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/badgeService.js', () => ({
  hasBadge: vi.fn(),
}));

import { hasBadge } from '../services/badgeService.js';
import {
  extractTransactionHash,
  waitForSuccessfulTransaction,
  verifyOnChainBadgeOwnership,
  confirmMintAndOwnership,
} from '../services/badges/mintVerification.js';

describe('mintVerification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extractTransactionHash supports wallet response variants', () => {
    expect(extractTransactionHash({ hash: '0x1' })).toBe('0x1');
    expect(extractTransactionHash({ transactionHash: '0x2' })).toBe('0x2');
    expect(extractTransactionHash({ txnHash: '0x3' })).toBe('0x3');
    expect(extractTransactionHash({})).toBeNull();
  });

  it('waitForSuccessfulTransaction throws when tx failed', async () => {
    const client = {
      waitForTransaction: vi.fn().mockResolvedValue({ success: false, vm_status: 'Move abort' }),
    };

    await expect(waitForSuccessfulTransaction({ client, txHash: '0xabc' }))
      .rejects
      .toThrow('Mint transaction failed: Move abort');
  });

  it('verifyOnChainBadgeOwnership throws when ownership is missing', async () => {
    hasBadge.mockResolvedValue(false);

    await expect(verifyOnChainBadgeOwnership({
      client: {},
      badgeId: 7,
      owner: '0xabc',
    })).rejects.toThrow('on-chain badge ownership was not confirmed');
  });

  it('confirmMintAndOwnership returns tx hash when all checks pass', async () => {
    const client = {
      waitForTransaction: vi.fn().mockResolvedValue({ success: true }),
    };
    hasBadge.mockResolvedValue(true);

    const txHash = await confirmMintAndOwnership({
      client,
      txResponse: { hash: '0xfeed' },
      badgeId: 11,
      owner: '0xabc',
    });

    expect(txHash).toBe('0xfeed');
    expect(client.waitForTransaction).toHaveBeenCalledWith({ transactionHash: '0xfeed' });
    expect(hasBadge).toHaveBeenCalledWith(client, 11, '0xabc');
  });
});
