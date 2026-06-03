import { useState, useEffect, useCallback, useRef } from 'react';

export type SyncStatus = 'idle' | 'queued' | 'syncing' | 'completed' | 'error';

export function useAnalyticsSync(
  walletAddress: string | null | undefined,
  isPremium: boolean,
  onSyncComplete: () => Promise<void>
) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncTriggerCount, setSyncTriggerCount] = useState(0);
  const hasAttemptedPartialFetch = useRef(false);

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  const onSyncCompleteRef = useRef(onSyncComplete);
  useEffect(() => {
    onSyncCompleteRef.current = onSyncComplete;
  }, [onSyncComplete]);

  const buildOwnerSyncQuery = useCallback(() => {
    return `wallet=${walletAddress || ''}`;
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !isPremium) return;

    let isMounted = true;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let failedPolls = 0;
    const MAX_FAILED_POLLS = 30;
    hasAttemptedPartialFetch.current = false;

    const stopPolling = () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const checkStatus = async (): Promise<boolean> => {
      if (!isMounted) return false;
      try {
        const res = await fetch(`${API_URL}/api/analytics/status?wallet=${walletAddress}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (!isMounted) return false;

        if (data.total_transactions > 0) {
          const progress = Math.min(
            100,
            Math.round((data.synced_transactions / data.total_transactions) * 100)
          );
          setSyncProgress(progress);
        }

        if (data.full_history_synced && data.status !== 'syncing' && data.status !== 'queued') {
          failedPolls = 0;
          setSyncStatus('completed');
          stopPolling();
          await onSyncCompleteRef.current();
          return true;
        }

        if (data.status === 'queued') {
          setSyncStatus('queued');
          setSyncProgress(0);
          
          // Trigger a partial fetch so the user sees existing data while waiting
          if (data.synced_transactions > 0 && !hasAttemptedPartialFetch.current) {
            hasAttemptedPartialFetch.current = true;
            try {
              await onSyncCompleteRef.current();
            } catch {}
          }
        } else if (data.status === 'syncing' || data.synced_transactions > 0 || data.last_sync_at) {
          setSyncStatus('syncing');

          if (data.total_transactions > 0) {
            const progress = Math.min(
              99, // cap at 99% while syncing, only show 100% when finalized
              Math.round((data.synced_transactions / data.total_transactions) * 100)
            );
            setSyncProgress(progress);
          }

          // If we have some synced transactions but haven't fetched data yet, do a partial fetch
          if (data.synced_transactions > 0 && !hasAttemptedPartialFetch.current) {
            hasAttemptedPartialFetch.current = true;
            // Trigger a data fetch with whatever partial data is available
            try {
              await onSyncCompleteRef.current();
            } catch {
              // Non-critical — data may not be available yet
            }
          }
        } else {
          failedPolls++;
          if (failedPolls >= MAX_FAILED_POLLS) {
            stopPolling();
            setSyncStatus('error');
          }
        }

        return false;
      } catch (err) {
        console.error('Status check error:', err);
        failedPolls++;
        if (failedPolls >= MAX_FAILED_POLLS) {
          stopPolling();
          setSyncStatus('error');
        }
        return false;
      }
    };

    const startSyncIfNeeded = async () => {
      try {
        const query = `wallet=${walletAddress}`;
        const res = await fetch(`${API_URL}/api/analytics/sync?${query}`);
        if (!isMounted) return;
        if (res.ok || res.status === 202 || res.status === 429) {
          setSyncStatus('syncing');
        }
      } catch {
        // Non-owner viewers rely on background worker / prior sync
      }
    };

    void (async () => {
      const alreadyComplete = await checkStatus();
      if (!isMounted) return;
      if (!alreadyComplete) {
        await startSyncIfNeeded();
        if (!isMounted) return;
        // Poll at 4s for active sync (faster feedback), 6s otherwise
        pollIntervalId = setInterval(() => {
          void checkStatus();
        }, 4000);
      }
    })();

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [walletAddress, isPremium, syncTriggerCount]);

  const handleStartSync = async () => {
    if (!walletAddress) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    hasAttemptedPartialFetch.current = false;
    try {
      const query = `wallet=${walletAddress}`;
      const res = await fetch(`${API_URL}/api/analytics/sync?${query}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Sync trigger failed');
      }
      setSyncTriggerCount(prev => prev + 1);
    } catch (err: unknown) {
      setSyncStatus('error');
      const message = err instanceof Error ? err.message : 'Failed to trigger sync';
      console.error('Sync trigger error:', err);
      setFetchError(message);
    }
  };

  return {
    syncStatus,
    syncProgress,
    fetchError,
    setFetchError,
    handleStartSync,
    buildOwnerSyncQuery
  };
}
