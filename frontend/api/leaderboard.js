import { createClient } from '@supabase/supabase-js';
import { setApiHeaders, handleOptions, methodNotAllowed } from './_lib/http.js';

const METHODS = ['GET', 'OPTIONS'];

const createSupabasePublic = () => {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

export default async function handler(req, res) {
  try {
    if (handleOptions(req, res, METHODS)) return;
    setApiHeaders(req, res, METHODS);
    if (req.method !== 'GET') return methodNotAllowed(res, req.method, METHODS);

    const supabase = createSupabasePublic();

    const { data, error } = await supabase
      .from('profiles')
      .select('wallet_address, username, avatar_url, xp, created_at')
      .order('xp', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }

    const leaderboard = (Array.isArray(data) ? data : []).map((row, index) => ({
      rank: index + 1,
      wallet_address: row.wallet_address,
      username: row.username,
      avatar_url: row.avatar_url,
      xp: Number(row.xp || 0),
    }));

    return res.status(200).json({ leaderboard });
  } catch (error) {
    console.error('[leaderboard] error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
