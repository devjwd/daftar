import { getSupabase } from '../config/supabase.ts';

/**
 * Periodically cleans up the address_labels table to prevent database bloat.
 * It removes older, automatically crawled labels that might be low-confidence or unused.
 */
export async function cleanupAddressLabels() {
  const supabaseAdmin = getSupabase();
  if (!supabaseAdmin) {
    console.error('[CleanupJob] Database unavailable');
    return;
  }

  console.log('[CleanupJob] Starting address_labels cleanup...');

  try {
    // Delete labels discovered via 'browser_crawl' that are older than 30 days.
    // In a full production system, we would also verify if they have been used by active users,
    // but this prevents indefinite unbounded bloat from the crawler catching every smart contract.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { error, count } = await supabaseAdmin
      .from('address_labels')
      .delete({ count: 'exact' })
      .eq('discovery_method', 'browser_crawl')
      .lt('created_at', thirtyDaysAgo.toISOString());

    if (error) {
      throw error;
    }

    console.log(`[CleanupJob] Successfully deleted ${count || 0} old crawled address labels.`);
  } catch (err) {
    console.error('[CleanupJob] Failed to clean up address_labels:', err);
  }
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupAddressLabels().then(() => process.exit(0)).catch(() => process.exit(1));
}
