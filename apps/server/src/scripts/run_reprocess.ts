import dotenv from 'dotenv';
import { getSupabase } from '../config/supabase.ts';
import { reProcessUnknownTransactions } from '../services/analyticsSyncService.ts';

dotenv.config();

const supabase = getSupabase();

async function run() {
  console.log('Starting dynamic protocol reprocess...');
  try {
    await reProcessUnknownTransactions(supabase);
    console.log('Finished reprocessing successfully!');
  } catch (err: any) {
    console.error('Error during reprocess:', err);
  }
}

run();
