import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: rootEnvPath });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const COINGECKO_API_KEY = (process.env.COINGECKO_API_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TOKENS_TO_FETCH = [
  { id: 'movement', addresses: ['0x1', '0xa'] },
  { id: 'bitcoin', addresses: ['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'] },
  { id: 'ethereum', addresses: ['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'] }
];

async function fetchAndUpload() {
  console.log(`🚀 Starting historical price sync for ${TOKENS_TO_FETCH.length} tokens...`);
  
  for (const token of TOKENS_TO_FETCH) {
    console.log(`\n🔹 Processing ${token.id.toUpperCase()}...`);
    
    let url = `https://api.coingecko.com/api/v3/coins/${token.id}/market_chart?vs_currency=usd&days=365&interval=daily`;
    if (COINGECKO_API_KEY) {
      url += `&x_cg_demo_api_key=${COINGECKO_API_KEY}`;
    }

    try {
      const response = await fetch(url);
      const json: any = await response.json();

      if (json.errors || !json.prices) {
        console.error(`❌ CoinGecko Error for ${token.id}:`, json);
        continue;
      }

      // 1. Save to local JSON file
      const dataDir = path.join(__dirname, 'src/data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const filePath = path.join(dataDir, `${token.id}_prices_1y.json`);
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
      console.log(`✅ Saved data to ${filePath}`);

      // 2. Upload to Database
      const batchSize = 100;
      for (const tokenAddr of token.addresses) {
        const records = json.prices.map((p: [number, number]) => ({
          token_address: tokenAddr,
          price: p[1],
          timestamp: new Date(p[0]).toISOString(),
          granularity: 'daily',
          source: 'coingecko'
        }));

        console.log(`📊 Uploading ${records.length} points for ${tokenAddr.substring(0, 10)}...`);

        // OPTIMIZATION: Delete existing to avoid constraint errors
        await supabase.from('token_price_history').delete().eq('token_address', tokenAddr);

        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const { error } = await supabase
            .from('token_price_history')
            .insert(batch); // Use insert instead of upsert since we deleted

          if (error) console.error(`Error uploading batch:`, error);
        }
      }
      
      console.log(`✨ Successfully synced ${token.id.toUpperCase()}`);
      
      // Delay to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`Fatal Error for ${token.id}:`, err);
    }
  }

  console.log("\n✅ All token prices synced successfully!");
}

fetchAndUpload();
