import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const { data: tx } = await supabase
    .from('user_transaction_history')
    .select('*')
    .eq('id', 'd31a4d5e-f8ff-4002-b331-ce6eccc31929'); // Wait, let's query by value or just search for the one with value_usd > 1000

  console.log('Tx 1:', tx);

  const { data: txs } = await supabase
    .from('user_transaction_history')
    .select('*')
    .gt('value_usd', 100)
    .eq('user_address', '0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f');

  console.log('All Txs > $100:', JSON.stringify(txs, null, 2));
}

main();
