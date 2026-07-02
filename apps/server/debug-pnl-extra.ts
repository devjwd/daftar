import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function testBackend() {
  const url = 'https://daftar-analytics-production.up.railway.app/api/analytics/pnl-precise?wallet=0x5077a6be218410fb5710a0d56278892c4563cb8b845aada96b5871b1f05a5c80&timeframe=1D';
  // Alternatively, test the local server if running, but we'll try to hit the DB directly to simulate backend logic.

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const staticExtraUsd = 1.45;
  const balances = [{ asset_type: '0x1', symbol: 'MOVE', amount: 40 }];

  const startDate = new Date();
  startDate.setHours(startDate.getHours() - 24);

  const { data: priceHist } = await supabase
    .from('token_price_history')
    .select('token_address, price, timestamp')
    .eq('granularity', '5min')
    .gte('timestamp', startDate.toISOString())
    .order('timestamp', { ascending: true });

  if (priceHist && priceHist.length >= 2) {
    const pricesByTime: any = {};
    priceHist.forEach((hp: any) => {
      const timeKey = new Date(hp.timestamp).toISOString();
      if (!pricesByTime[timeKey]) pricesByTime[timeKey] = {};
      pricesByTime[timeKey][hp.token_address] = Number(hp.price);
    });

    const uniqueTimestamps = Object.keys(pricesByTime).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const history = uniqueTimestamps.map((timeISO) => {
      let totalValuation = staticExtraUsd;
      balances.forEach((b: any) => {
        const price = pricesByTime[timeISO]['0x1'] || 0;
        totalValuation += Number(b.amount || 0) * price;
      });
      return { date: timeISO, value: totalValuation };
    });

    console.log("First point:", history[0]);
    console.log("Last point:", history[history.length - 1]);
  } else {
    console.log("No price history");
  }
}

testBackend().catch(console.error);
