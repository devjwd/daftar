import { SupabaseClient } from '@supabase/supabase-js';
import { syncFullUserHistory } from './analyticsSyncService.ts';
import { takeNetworthSnapshot } from './networthService.ts';

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
    .select('*')
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
 * Process the next pending job in the queue.
 * Orders by priority (descending) and then created_at (ascending).
 */
export async function processSyncQueue(supabase: SupabaseClient) {
  // 1. Fetch next pending job
  const { data: nextJob, error: fetchError } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error('[SyncQueue] Error fetching next job:', fetchError.message);
    return;
  }

  if (!nextJob) {
    // No pending jobs
    return;
  }

  const { id, user_address: address } = nextJob;

  // 2. Lock the job by transitioning to 'processing'
  const { data: lockedJob, error: lockError } = await supabase
    .from('sync_queue')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (lockError) {
    console.error(`[SyncQueue] Lock error for job ${id}:`, lockError.message);
    return;
  }

  if (!lockedJob) {
    // Already picked up by another worker
    return;
  }

  console.log(`[SyncQueue] 🚀 Processing sync job for ${address} (Priority: ${lockedJob.priority})...`);

  try {
    // 3. Execute deep sync
    const syncResult = await syncFullUserHistory(supabase, address);
    const hasNewTx = syncResult && syncResult.totalSynced > 0;

    // 4. Take net worth snapshot
    await takeNetworthSnapshot(supabase, address, hasNewTx);

    // 5. Mark job as completed
    await supabase
      .from('sync_queue')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id);

    console.log(`[SyncQueue] ✅ Successfully processed sync job for ${address}`);
  } catch (err: any) {
    console.error(`[SyncQueue] ❌ Failed processing sync job for ${address}:`, err.message);

    // 6. Mark job as failed
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
