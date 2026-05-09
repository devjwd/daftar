import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { checkBadgeEligibility } from '../services/api';
import { BadgeDefinition, EligibilityResult } from '@daftar/types';

export const useBadgeEligibility = (badge: BadgeDefinition) => {
  const { account, connected } = useWallet();
  const address = connected && account?.address 
    ? (typeof account.address === 'string' ? account.address : account.address.toString())
    : null;

  const [status, setStatus] = useState<'idle' | 'loading' | 'eligible' | 'not_eligible' | 'error' | 'already_owned' | 'requires_admin'>('idle');
  const [progress, setProgress] = useState<EligibilityResult['progress']>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkEligibility = useCallback(async (options: { force?: boolean } = {}) => {
    if (!address || !badge?.id) return;
    
    // If already earned, don't re-check unless forced
    if (badge.earned && !options.force) {
      setStatus('already_owned');
      return;
    }

    setIsLoading(true);
    setStatus('loading');
    setReason(null);

    try {
      const result = await checkBadgeEligibility(badge.id, address);
      if (result) {
        setStatus(result.eligible ? 'eligible' : 'not_eligible');
        setProgress(result.progress);
        setReason(result.reason);
      } else {
        setStatus('error');
        setReason('No result from server');
      }
    } catch (err: any) {
      console.error('[useBadgeEligibility] Check failed:', err);
      setStatus('error');
      setReason(err.message || 'Failed to check eligibility');
    } finally {
      setIsLoading(false);
    }
  }, [address, badge?.id, badge?.earned]);

  // Auto-check on mount or address change
  useEffect(() => {
    if (address && badge?.id && !badge.earned) {
      checkEligibility();
    }
  }, [address, badge?.id]); // Only re-run when wallet or badge changes

  return {
    status,
    progress,
    reason,
    isLoading,
    checkEligibility
  };
};
