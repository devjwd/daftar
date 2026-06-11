import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { ApyService } from '../services/apyService.ts';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  console.log('🚀 Starting APY Sync...');

  try {
    const apys = await ApyService.fetchAllApys();
    
    if (apys.length === 0) {
      console.log('⚠️ No APYs fetched. Exiting.');
      process.exit(0);
    }
    
    console.log(`✅ Fetched ${apys.length} APY records from on-chain calculation.`);
    
    for (const apyData of apys) {
      const { error } = await supabase
        .from('protocol_apys')
        .upsert(
          {
            protocol: apyData.protocol,
            pool_name: apyData.pool_name,
            pool_address: apyData.pool_address,
            apy: apyData.apy,
            base_apr: apyData.base_apr,
            reward_apr: apyData.reward_apr,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'protocol, pool_address' }
        );
        
      if (error) {
        console.error(`❌ Failed to upsert APY for ${apyData.protocol} - ${apyData.pool_name}:`, error.message);
      } else {
        console.log(`✅ Upserted ${apyData.protocol} - ${apyData.pool_name} -> APY: ${(apyData.apy * 100).toFixed(2)}%`);
      }
    }
    
  } catch (error) {
    console.error('❌ Critical error during APY sync:', error);
  }

  console.log('🎉 APY Sync complete!');
  process.exit(0);
}

run();
