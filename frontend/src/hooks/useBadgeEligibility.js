import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { verifyBadge } from '../services/badgeApi.js';

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getWalletAddress = (account) => {
  if (!account?.address) return '';
  const value = typeof account.address === 'string' ? account.address : account.address.toString();
  return normalizeAddress(value);
};

export const resolveEligibilityBadgeId = (badgeOrId) => {
  if (badgeOrId && typeof badgeOrId === 'object') {
    const onChainBadgeId = Number(badgeOrId.onChainBadgeId);
    if (Number.isInteger(onChainBadgeId) && onChainBadgeId >= 0) {
      return onChainBadgeId;
    }

    const numericBadgeId = Number(badgeOrId.badgeId);
    if (Number.isInteger(numericBadgeId) && numericBadgeId >= 0) {
      return numericBadgeId;
    }
  }

  const numericBadgeId = Number(badgeOrId);
  return Number.isInteger(numericBadgeId) && numericBadgeId >= 0 ? numericBadgeId : null;
};

export default function useBadgeEligibility(badgeOrId) {
  const { account } = useWallet();
  const walletAddress = getWalletAddress(account);

  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [proof, setProof] = useState(null);
  const [reason, setReason] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const cacheRef = useRef({
    wallet: null,
    badgeId: null,
    result: null,
  });

  const applyResult = useCallback((result) => {
    setStatus(result.status || 'error');
    setProgress(result.progress || null);
    setProof(result.proof || null);
    setReason(result.reason || null);
  }, []);

  const checkEligibility = useCallback(async (options = {}) => {
    const force = Boolean(options?.force);
    const numericBadgeId = resolveEligibilityBadgeId(badgeOrId);

    if (!walletAddress) {
      const result = {
        status: 'error',
        progress: null,
        proof: null,
        reason: 'Wallet not connected',
      };
      applyResult(result);
      return result;
    }

    if (!Number.isInteger(numericBadgeId) || numericBadgeId < 0) {
      const result = {
        status: 'error',
        progress: null,
        proof: null,
        reason: 'Badge is not published on-chain yet',
      };
      applyResult(result);
      return result;
    }

    const cached = cacheRef.current;
    const canUseCache = !force && cached.result && cached.wallet === walletAddress && cached.badgeId === numericBadgeId;
    if (canUseCache) {
      applyResult(cached.result);
      return cached.result;
    }

    setIsLoading(true);
    setStatus('loading');
    setReason(null);

    try {
      const { data, error } = await verifyBadge(walletAddress, numericBadgeId);
      const normalizedStatus = error
        ? 'error'
        : data?.eligible
          ? 'eligible'
          : 'not_eligible';

      const result = {
        status: normalizedStatus,
        progress: null,
        proof: null,
        reason: error?.message || data?.error || null,
      };

      cacheRef.current = {
        wallet: walletAddress,
        badgeId: numericBadgeId,
        result,
      };

      applyResult(result);
      return result;
    } catch (error) {
      const result = {
        status: 'error',
        progress: null,
        proof: null,
        reason: String(error?.message || 'Eligibility check failed'),
      };
      applyResult(result);
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [applyResult, badgeOrId, walletAddress]);

  return {
    status,
    progress,
    proof,
    reason,
    checkEligibility,
    isLoading,
  };
}
