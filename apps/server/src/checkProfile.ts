import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const target = '0x19884944fe90b872088378e681db279b254667384a0ef0fbc8f2d5a8c1713051';
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('wallet_address', target)
    .maybeSingle();

  if (error) {
    console.error(error);
    return;
  }
  console.log('PROFILE RESULT:', JSON.stringify(data, null, 2));
}

main();
