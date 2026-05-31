import { SupabaseClient } from '@supabase/supabase-js';
import { reProcessUnknownTransactions } from './analyticsSyncService.ts';
import { reProcessSuspiciousPrices } from './analyticsPriceService.ts';
import { queueSync } from './analyticsSyncQueue.ts';

const USERS_PER_PAGE = 100;
const CONCURRENCY_LIMIT = 5;

/**
 * Collect unique wallet addresses that should receive background sync.
 * Verified profiles and active subscriptions are fetched in separate paginated
 * loops to avoid incorrect interleaved pagination across two tables.
 */
async function collectSyncWalletAddresses(supabase: SupabaseClient): Promise<Map<string, number>> {
  const userMap = new Map<string, number>();

  const paginateTable = async (
    table: 'profiles' | 'user_subscriptions',
    filter: Record<string, unknown>,
    priority: number
  ) => {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase.from(table).select('wallet_address');

      Object.entries(filter).forEach(([key, value]) => {
        query = query.eq(key, value);
      });

      const { data, error } = await query.range(
        page * USERS_PER_PAGE,
        (page + 1) * USERS_PER_PAGE - 1
      );

      if (error) throw error;

      data?.forEach((row: { wallet_address: string | null }) => {
        if (!row.wallet_address) return;
        const existing = userMap.get(row.wallet_address);
        if (existing === undefined || priority > existing) {
          userMap.set(row.wallet_address, priority);
        }
      });

      hasMore = (data?.length || 0) === USERS_PER_PAGE;
      page++;
    }
  };

  await paginateTable('profiles', { is_verified: true }, 0);
  await paginateTable('user_subscriptions', { status: 'active' }, 1);

  return userMap;
}

/**
 * Background worker that continuously syncs verified users.
 */
export async function startAnalyticsWorker(supabase: SupabaseClient) {
  console.log('[AnalyticsWorker] 🤖 Starting 24/7 background worker for verified users...');

  const BASE_SLEEP_MS = 15 * 60 * 1000;
  const MAX_SLEEP_MS = 45 * 60 * 1000;
  let consecutiveErrors = 0;
  let lastCleanupTime = 0;
  const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

  const runLoop = async () => {
    try {
      const now = Date.now();
      if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
        console.log('[AnalyticsWorker] Running database maintenance and cleanups...');
        await reProcessUnknownTransactions(supabase);
        await reProcessSuspiciousPrices(supabase);
        lastCleanupTime = now;
      }

      const userMap = await collectSyncWalletAddresses(supabase);
      const batchUsers = Array.from(userMap.entries()).map(([wallet_address, priority]) => ({
        wallet_address,
        priority,
      }));

      if (batchUsers.length > 0) {
        console.log(`[AnalyticsWorker] 🔄 Beginning sync cycle for ${batchUsers.length} wallets...`);

        for (let i = 0; i < batchUsers.length; i += CONCURRENCY_LIMIT) {
          const batch = batchUsers.slice(i, i + CONCURRENCY_LIMIT);

          await Promise.all(
            batch.map(async (user) => {
              try {
                await queueSync(supabase, user.wallet_address, user.priority);
              } catch (syncErr: unknown) {
                const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
                console.error(`[AnalyticsWorker] Error queueing user ${user.wallet_address}:`, message);
              }
            })
          );

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        console.log('[AnalyticsWorker] No wallets to sync this cycle.');
      }

      console.log(`[AnalyticsWorker] ✅ Sync cycle complete. Total users processed: ${batchUsers.length}`);
      consecutiveErrors = 0;
    } catch (e: unknown) {
      consecutiveErrors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[AnalyticsWorker] Main loop error (consecutive: ${consecutiveErrors}):`, message);
    } finally {
      const sleepMs = Math.min(MAX_SLEEP_MS, BASE_SLEEP_MS * (1 + consecutiveErrors));
      console.log(`[AnalyticsWorker] 💤 Cycle complete. Sleeping for ${Math.round(sleepMs / 60000)} minutes...`);
      setTimeout(runLoop, sleepMs);
    }
  };

  runLoop();
}
