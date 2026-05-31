import { useState, useEffect, useCallback } from 'react';

export type SyncStatus = 'idle' | 'syncing' | 'completed' | 'error';

export function useAnalyticsSync(
  walletAddress: string | null | undefined,
  isPremium: boolean,
  getConnectedAddress: () => string | null,
  signMessage: any,
  onSyncComplete: () => Promise<void>
) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  const buildOwnerSyncQuery = useCallback(async () => {
    if (!walletAddress) return `wallet=${walletAddress}`;

    let queryParams = `wallet=${walletAddress}`;
    const normalizedConnected = getConnectedAddress();
    const isOwner = normalizedConnected && normalizedConnected === walletAddress.toLowerCase();

    if (isOwner && typeof signMessage === 'function') {
      const timestamp = new Date().toISOString();
      const message = `Sync transaction history for wallet ${walletAddress}\nTimestamp: ${timestamp}`;
      const signResult = await signMessage({ message, nonce: timestamp });
      queryParams += `&message=${encodeURIComponent(message)}&signature=${encodeURIComponent(JSON.stringify(signResult))}`;
    }

    return queryParams;
  }, [walletAddress, getConnectedAddress, signMessage]);

  useEffect(() => {
    if (!walletAddress || !isPremium) return;

    let isMounted = true;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let failedPolls = 0;
    const MAX_FAILED_POLLS = 30;

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

        if (data.full_history_synced) {
          failedPolls = 0;
          setSyncStatus('completed');
          stopPolling();
          await onSyncComplete();
          return true;
        }

        if (data.is_queued || data.synced_transactions > 0 || data.last_sync_at) {
          setSyncStatus('syncing');
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
        const query = await buildOwnerSyncQuery();
        const res = await fetch(`${API_URL}/api/analytics/sync?${query}`);
        if (res.ok || res.status === 202 || res.status === 429) {
          setSyncStatus('syncing');
        }
      } catch {
        // Non-owner viewers rely on background worker / prior sync
      }
    };

    void (async () => {
      const alreadyComplete = await checkStatus();
      if (!alreadyComplete) {
        await startSyncIfNeeded();
        pollIntervalId = setInterval(() => {
          void checkStatus();
        }, 6000);
      }
    })();

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [walletAddress, isPremium, API_URL, buildOwnerSyncQuery, onSyncComplete]);

  const handleStartSync = async () => {
    if (!walletAddress) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    try {
      const query = await buildOwnerSyncQuery();
      const res = await fetch(`${API_URL}/api/analytics/sync?${query}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Sync trigger failed');
      }
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
