import { createClient } from '@supabase/supabase-js';

let cachedSupabaseAdmin = null;

export const getSupabaseAdmin = () => {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  cachedSupabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabaseAdmin;
};

export default getSupabaseAdmin;