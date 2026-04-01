import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';

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

export default function useBadgeEligibility(badgeId) {
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
    const numericBadgeId = Number(badgeId);

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
        reason: 'Invalid badgeId',
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
      const query = new URLSearchParams({
        wallet: walletAddress,
        badgeId: String(numericBadgeId),
      });

      const response = await fetch(`/api/badges/eligibility?${query.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const data = await response.json().catch(() => ({}));
      const normalizedStatus =
        data?.status === 'eligible' ||
        data?.status === 'not_eligible' ||
        data?.status === 'already_owned' ||
        data?.status === 'requires_admin'
          ? data.status
          : response.ok
            ? 'error'
            : data?.status || 'error';

      const result = {
        status: normalizedStatus,
        progress: data?.progress || null,
        proof: data?.proof || null,
        reason: data?.reason || data?.error || null,
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
  }, [applyResult, badgeId, walletAddress]);

  return {
    status,
    progress,
    proof,
    reason,
    checkEligibility,
    isLoading,
  };
}
