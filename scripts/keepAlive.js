import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function keepAlive() {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (error) {
      console.error(error);
      process.exit(1);
    }

    console.log('Supabase alive');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

keepAlive();
