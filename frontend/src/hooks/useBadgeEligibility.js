import { evaluateBadge } from '../services/badges/engineService.js';
import { fetchBadge } from '../services/badgeService.js';
import { useMovementClient } from './useMovementClient.js';

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
    const definitionId = String(badgeOrId.id || '').trim();
    if (definitionId) {
      return definitionId;
    }

    const onChainBadgeId = Number(badgeOrId.onChainBadgeId);
    if (Number.isInteger(onChainBadgeId) && onChainBadgeId >= 0) {
      return String(onChainBadgeId);
    }

    const numericBadgeId = Number(badgeOrId.badgeId);
    if (Number.isInteger(numericBadgeId) && numericBadgeId >= 0) {
      return String(numericBadgeId);
    }

    return null;
  }

  const raw = String(badgeOrId ?? '').trim();
  if (!raw) return null;
  return raw;
};

export default function useBadgeEligibility(badgeOrId) {
  const { account } = useWallet();
  const { client: movementClient } = useMovementClient();
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
    const resolvedBadgeId = resolveEligibilityBadgeId(badgeOrId);

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

    if (!resolvedBadgeId) {
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
    const canUseCache = !force && cached.result && cached.wallet === walletAddress && cached.badgeId === resolvedBadgeId;
    if (canUseCache) {
      applyResult(cached.result);
      return cached.result;
    }

    setIsLoading(true);
    setStatus('loading');
    setReason(null);

    try {
      // 1. Fetch badge definition stats if needed
      // 2. Run local evaluation engine
      const evaluation = await evaluateBadge(walletAddress, badgeOrId);
      
      const normalizedStatus = evaluation.eligible ? 'eligible' : 'not_eligible';

      const result = {
        status: normalizedStatus,
        progress: evaluation.progress || null,
        proof: null,
        reason: evaluation.reason || null,
      };

      cacheRef.current = {
        wallet: walletAddress,
        badgeId: resolvedBadgeId,
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
