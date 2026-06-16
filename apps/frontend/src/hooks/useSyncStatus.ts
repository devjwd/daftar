import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

interface SyncProgress {
  synced: number;
  total: number;
}

export function useSyncStatus(walletAddress: string | undefined, active: boolean = true) {
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ synced: 0, total: 0 });
  const [isFullySynced, setIsFullySynced] = useState<boolean>(true); // Default true until we check
  const [hasStartedChecking, setHasStartedChecking] = useState<boolean>(false);

  useEffect(() => {
    if (!walletAddress || !active) return;

    let pollTimer: NodeJS.Timeout;
    let isActive = true;

    const poll = async () => {
      try {
        const { data, error } = await supabase
          .from('user_sync_status')
          .select('full_history_synced, synced_transactions, total_transactions, sync_error')
          .eq('user_address', walletAddress.toLowerCase())
          .maybeSingle();

        if (error) {
          console.error('Sync polling error:', error);
        }

        if (data && isActive) {
          setHasStartedChecking(true);
          setSyncProgress({
            synced: data.synced_transactions || 0,
            total: data.total_transactions || 0
          });
          setIsFullySynced(data.full_history_synced);

          if (data.full_history_synced) {
            return; // Stop polling
          }
        }
      } catch (e) {
        console.error('Failed to poll sync status', e);
      }

      if (isActive) {
        pollTimer = setTimeout(poll, 3000);
      }
    };

    poll();

    return () => {
      isActive = false;
      clearTimeout(pollTimer);
    };
  }, [walletAddress, active]);

  return { syncProgress, isFullySynced, hasStartedChecking };
}
