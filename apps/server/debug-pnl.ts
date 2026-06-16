import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const wallet = '0x5077a6be218410fb5710a0d56278892c4563cb8b845aada96b5871b1f05a5c80';
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - 24);

  console.log("Checking 5-min price history from", startDate.toISOString());

  const { data: priceHist, error } = await supabase
    .from('token_price_history')
    .select('token_address, price, timestamp')
    .eq('granularity', '5min')
    .gte('timestamp', startDate.toISOString())
    .order('timestamp', { ascending: true })
    .limit(10);

  if (error) {
    console.error("Error fetching price hist:", error);
  } else {
    console.log("Price history samples (5min):", priceHist?.length);
    if (priceHist?.length) {
      console.log(priceHist[0]);
    }
  }

  const { data: bData } = await supabase
    .from('user_balance_snapshots')
    .select('snapshot_date')
    .eq('user_address', wallet)
    .order('snapshot_date', { ascending: false })
    .limit(1);
    
  console.log("Latest snapshot date:", bData);
}

test().catch(console.error);
