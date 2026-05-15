import { SupabaseClient } from '@supabase/supabase-js';
import { updateNFTFloorPrices } from './nftPriceService.ts';

export async function startNFTPriceWorker(supabase: SupabaseClient) {
  console.log('[NFTPriceWorker] 🤖 Starting background worker for NFT floor prices...');

  // Run immediately on start
  void updateNFTFloorPrices(supabase);

  // Then run every 1 hour
  const ONE_HOUR = 60 * 60 * 1000;
  
  setInterval(async () => {
    try {
      await updateNFTFloorPrices(supabase);
    } catch (err: any) {
      console.error('[NFTPriceWorker] ❌ Error in worker loop:', err.message);
    }
  }, ONE_HOUR);
}
