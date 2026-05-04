import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/envValidator';

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
