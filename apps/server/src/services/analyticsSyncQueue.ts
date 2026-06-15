import { SupabaseClient } from '@supabase/supabase-js';
import { syncFullUserHistory } from './analyticsSyncService.ts';
import { takeNetworthSnapshot } from './networthService.ts';
import { backfillTransactionPrices } from './analyticsPriceService.ts';
import { analyticsCache } from './analyticsCache.ts';

/**
 * Queue a wallet address for transaction sync.
 * If there is already a pending or processing job for this address, it keeps the existing job.
 * If priority is higher than the existing job's priority, it updates the priority of a pending job.
 */
export async function queueSync(
  supabase: SupabaseClient,
  walletAddress: string,
  priority: number = 0
) {
  const address = walletAddress.toLowerCase().trim();

  // Check if there is an active job (pending or processing)
  const { data: existingJob, error: checkError } = await supabase
    .from('sync_queue')
    .select('id, status, priority')
    .eq('user_address', address)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (checkError) {
    console.error(`[SyncQueue] Error checking active job for ${address}:`, checkError.message);
  }

  if (existingJob) {
    // If the new request has higher priority, raise the priority of the pending job
    if (existingJob.status === 'pending' && priority > (existingJob.priority || 0)) {
      await supabase
        .from('sync_queue')
        .update({ priority, updated_at: new Date().toISOString() })
        .eq('id', existingJob.id);
    }
    return existingJob;
  }

  // Insert or reset job to pending
  const { data: newJob, error: insertError } = await supabase
    .from('sync_queue')
    .upsert({
      user_address: address,
      status: 'pending',
      priority,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_address' })
    .select()
    .single();

  if (insertError) {
    console.error(`[SyncQueue] Error queueing sync for ${address}:`, insertError.message);
    throw insertError;
  }

  return newJob;
}

/**
 * Internal: claim and lock a single pending job via optimistic locking.
 * Returns the locked job or null if nothing was available or job was already claimed.
 * Skips addresses already in-flight to prevent double-processing the same wallet.
 */
async function claimNextPendingJob(
  supabase: SupabaseClient,
  skipAddresses: string[] = []
): Promise<{ id: string; user_address: string; priority: number | null } | null> {
  // Fetch next pending job (may be filtered client-side for skipAddresses)
  let query = supabase
    .from('sync_queue')
    .select('id, user_address, priority')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(10); // Fetch a few candidates so we can skip in-flight ones

  const { data: candidates, error: fetchError } = await query;

  if (fetchError) {
    console.error('[SyncQueue] Error fetching next job:', fetchError.message);
    return null;
  }

  if (!candidates || candidates.length === 0) return null;

  // Pick the first candidate not already in-flight
  const candidate = candidates.find(j => !skipAddresses.includes(j.user_address));
  if (!candidate) return null;

  // Optimistic lock: only update if status is still 'pending'
  const { data: lockedJob, error: lockError } = await supabase
    .from('sync_queue')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', 'pending') // Guard: only succeed if not already claimed
    .select()
    .maybeSingle();

  if (lockError) {
    console.error(`[SyncQueue] Lock error for job ${candidate.id}:`, lockError.message);
    return null;
  }

  // null means another concurrent worker already claimed it — gracefully skip
  return lockedJob;
}

/**
 * Internal: execute a single locked sync job to completion.
 */
async function executeLockedJob(
  supabase: SupabaseClient,
  lockedJob: { id: string; user_address: string; priority: number | null }
): Promise<void> {
  const { id, user_address: address } = lockedJob;

  console.log(`[SyncQueue] 🚀 Processing sync job for ${address} (Priority: ${lockedJob.priority})...`);

  try {
    // Deep sync: fetch all transactions from blockchain and store in DB
    const syncResult = await syncFullUserHistory(supabase, address);
    const hasNewTx = syncResult && syncResult.totalSynced > 0;

    // Take net worth snapshot (force if new transactions synced or high-priority)
    const forceSnapshot = hasNewTx || (lockedJob.priority || 0) > 0;
    await takeNetworthSnapshot(supabase, address, forceSnapshot);

    // Mark job as completed
    await supabase
      .from('sync_queue')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id);

    console.log(`[SyncQueue] ✅ Successfully processed sync job for ${address}`);

    // Invalidate analytics cache so next request re-computes fresh data
    analyticsCache.invalidate(address);

    // Price backfill runs in background — don't block the queue
    void backfillTransactionPrices(supabase, 200, address).catch(err => {
      console.error('[SyncQueue] Immediate price backfill error:', err.message);
    });

  } catch (err: any) {
    console.error(`[SyncQueue] ❌ Failed processing sync job for ${address}:`, err.message);

    await supabase
      .from('sync_queue')
      .update({
        status: 'failed',
        error_message: err.message || 'Unknown error',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
  }
}

/**
 * Process the next single pending job in the queue (single-job, backward-compat).
 * Orders by priority (descending) then created_at (ascending).
 */
export async function processSyncQueue(supabase: SupabaseClient): Promise<void> {
  const job = await claimNextPendingJob(supabase);
  if (!job) return;
  await executeLockedJob(supabase, job);
}

/**
 * Drain the sync queue by processing up to `concurrency` jobs in parallel.
 *
 * This is the production-grade entrypoint that handles bursts of concurrent upgrades.
 * With concurrency=5 and jobs taking ~30s each, throughput is ~10 jobs/min vs 12/min
 * serially — but latency for each individual user drops from minutes to seconds.
 *
 * Each job is claimed with optimistic locking, preventing double-processing even when
 * multiple server instances or concurrent intervals call this function simultaneously.
 *
 * @returns Number of jobs that were started this drain cycle.
 */
export async function drainSyncQueue(
  supabase: SupabaseClient,
  concurrency: number = 5
): Promise<number> {
  const inFlightAddresses: string[] = [];
  const jobPromises: Promise<void>[] = [];

  // Claim up to `concurrency` jobs sequentially (to safely skip in-flight ones)
  for (let i = 0; i < concurrency; i++) {
    const job = await claimNextPendingJob(supabase, inFlightAddresses);
    if (!job) break; // No more available pending jobs

    inFlightAddresses.push(job.user_address);
    // Execute all claimed jobs concurrently
    jobPromises.push(executeLockedJob(supabase, job));
  }

  if (jobPromises.length === 0) return 0;

  console.log(`[SyncQueue] 🔄 Draining queue: ${jobPromises.length} jobs running in parallel...`);

  // Wait for all jobs, capturing errors (each job handles its own error internally)
  await Promise.allSettled(jobPromises);

  console.log(`[SyncQueue] ✅ Drain cycle complete. Ran ${jobPromises.length} jobs.`);
  return jobPromises.length;
}
