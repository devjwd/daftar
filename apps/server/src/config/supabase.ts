import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@daftar/shared-types';
import CONFIG from './index';

const { URL: SUPABASE_URL, SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY } = CONFIG.SUPABASE;

let supabaseAdmin: SupabaseClient<Database> | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabaseAdmin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Supabase] Admin client initialized successfully');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown initialization error';
    console.error('[Supabase] Failed to initialize:', message);
  }
} else {
  console.error('[Supabase] CRITICAL: Credentials missing!');
}

export const getSupabase = () => {
  if (!supabaseAdmin) {
    throw new Error('Supabase client not initialized');
  }
  return supabaseAdmin;
};

export default supabaseAdmin;
