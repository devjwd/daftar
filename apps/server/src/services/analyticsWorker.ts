import { SupabaseClient } from '@supabase/supabase-js';
import { reProcessUnknownTransactions } from './analyticsSyncService.ts';
import { reProcessSuspiciousPrices } from './analyticsPriceService.ts';
import { queueSync } from './analyticsSyncQueue.ts';

/**
 * Background worker that continuously syncs verified users.
 * 
 * - Loops through all verified profiles.
 * - Triggers an incremental sync (both forward and backward) via syncFullUserHistory.
 * - Sleeps between users and batches to respect Indexer rate limits.
 * - Uses exponential backoff on consecutive errors.
 */
export async function startAnalyticsWorker(supabase: SupabaseClient) {
  console.log('[AnalyticsWorker] 🤖 Starting 24/7 background worker for verified users...');

  const BASE_SLEEP_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_SLEEP_MS = 45 * 60 * 1000; // 45 minutes max backoff
  let consecutiveErrors = 0;
  let lastCleanupTime = 0;
  const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

  // The main loop
  const runLoop = async () => {
    try {
      // 0. Retroactively fix any Unknown protocols or suspicious prices (only once every 12 hours)
      const now = Date.now();
      if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
        console.log('[AnalyticsWorker] Running database maintenance and cleanups...');
        await reProcessUnknownTransactions(supabase);
        await reProcessSuspiciousPrices(supabase);
        lastCleanupTime = now;
      }

      // 1. Fetch all users to sync (verified + active subscribers)
      let hasMoreUsers = true;
      let page = 0;
      const USERS_PER_PAGE = 100;
      let totalProcessed = 0;

      while (hasMoreUsers) {
        // Fetch verified profiles
        const { data: verifiedUsers, error: verifiedError } = await supabase
          .from('profiles')
          .select('wallet_address')
          .eq('is_verified', true)
          .range(page * USERS_PER_PAGE, (page + 1) * USERS_PER_PAGE - 1);

        if (verifiedError) {
          console.error('[AnalyticsWorker] Failed to fetch verified users:', verifiedError);
          throw verifiedError;
        }

        // Fetch active pro subscribers
        const { data: proUsers, error: proError } = await supabase
          .from('user_subscriptions')
          .select('wallet_address')
          .eq('status', 'active')
          .range(page * USERS_PER_PAGE, (page + 1) * USERS_PER_PAGE - 1);

        if (proError) {
          console.error('[AnalyticsWorker] Failed to fetch pro users:', proError);
          throw proError;
        }

        // Combine and deduplicate
        const userMap = new Map<string, { priority: number }>();
        
        verifiedUsers?.forEach(u => {
          if (u.wallet_address) userMap.set(u.wallet_address, { priority: 0 });
        });
        
        proUsers?.forEach(u => {
          if (u.wallet_address) userMap.set(u.wallet_address, { priority: 1 }); // Pro users get higher priority
        });

        const batchUsers = Array.from(userMap.entries()).map(([wallet_address, data]) => ({
          wallet_address,
          priority: data.priority
        }));

        if (batchUsers.length > 0) {
          if (page === 0) console.log(`[AnalyticsWorker] 🔄 Beginning sync cycle. Fetching in batches...`);
          
          // 2. Iterate through verified/pro users in batches (concurrency pool)
          const CONCURRENCY_LIMIT = 5;
          for (let i = 0; i < batchUsers.length; i += CONCURRENCY_LIMIT) {
            const batch = batchUsers.slice(i, i + CONCURRENCY_LIMIT);
            
            await Promise.all(batch.map(async (user) => {
              try {
                await queueSync(supabase, user.wallet_address, user.priority);
              } catch (syncErr: any) {
                console.error(`[AnalyticsWorker] Error queueing user ${user.wallet_address}:`, syncErr.message);
              }
            }));
            
            totalProcessed += batch.length;
            // Sleep 1 second between batches to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          page++;
          if ((verifiedUsers?.length || 0) < USERS_PER_PAGE && (proUsers?.length || 0) < USERS_PER_PAGE) {
            hasMoreUsers = false;
          }
        } else {
          hasMoreUsers = false;
        }
      }
      
      console.log(`[AnalyticsWorker] ✅ Sync cycle complete. Total users processed: ${totalProcessed}`);

      // Reset backoff on successful cycle
      consecutiveErrors = 0;

    } catch (e: any) {
      consecutiveErrors++;
      console.error(`[AnalyticsWorker] Main loop error (consecutive: ${consecutiveErrors}):`, e.message);
    } finally {
      // Exponential backoff
      const sleepMs = Math.min(MAX_SLEEP_MS, BASE_SLEEP_MS * (1 + consecutiveErrors));
      console.log(`[AnalyticsWorker] 💤 Cycle complete. Sleeping for ${Math.round(sleepMs / 60000)} minutes...`);
      setTimeout(runLoop, sleepMs);
    }
  };

  // Start the first cycle
  runLoop();
}
