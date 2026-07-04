/* global process, console */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'e:/Daftar on movement/daftar/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const wallet = '0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f';
  const { data, error } = await supabase
    .from('user_networth_snapshots')
    .select('*')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: false })
    .limit(5);
    
  console.log('Snapshots:', data);
}

check();
