import { createClient } from '@supabase/supabase-js';

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.BADGE_CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const supabase = createSupabaseAdmin();

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
