import dotenv from 'dotenv';
import { getSupabase } from './src/config/supabase.ts';
import { updateNFTFloorPrices } from './src/services/nftPriceService.ts';

dotenv.config();

async function runTest() {
  console.log('--- STARTING LOCAL SCRAPER TEST ---');
  const supabase = getSupabase();
  
  try {
    await updateNFTFloorPrices(supabase);
    console.log('--- TEST FINISHED SUCCESSFULLY ---');
  } catch (err) {
    console.error('--- TEST FAILED ---', err);
  } finally {
    process.exit(0);
  }
}

runTest();
