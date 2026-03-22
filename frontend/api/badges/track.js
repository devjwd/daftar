/**
 * POST /api/badges/track
 * Adds a wallet address to the tracked list in Supabase.
 *
 * Body: { address: string }
 * Header: x-admin-key: <BADGE_ADMIN_API_KEY>
 */
import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp } from '../_lib/http.js';

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const isLikelyAddress = (address) =>
  /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const ip = getClientIp(req);
    const limiter = enforceRateLimit({
      key: `badges:track:write:${ip}`,
      limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
      windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests' });
    }

    const auth = checkAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { address } = req.body || {};
    if (!address || !isLikelyAddress(address)) {
      return res.status(400).json({ error: 'valid address required' });
    }

    const trackedAddress = normalizeAddress(address);
    const supabase = createSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const trackedUpsert = await supabase
      .from('badge_tracked_addresses')
      .upsert(
        {
          wallet_address: trackedAddress,
          updated_at: nowIso,
        },
        { onConflict: 'wallet_address' }
      );

    if (trackedUpsert.error && trackedUpsert.error.code !== '42P01') {
      return res.status(500).json({ error: trackedUpsert.error.message || 'Failed to track address' });
    }

    const profileUpsert = await supabase
      .from('profiles')
      .upsert(
        {
          wallet_address: trackedAddress,
          created_at: nowIso,
        },
        { onConflict: 'wallet_address', ignoreDuplicates: true }
      );

    if (profileUpsert.error) {
      return res.status(500).json({ error: profileUpsert.error.message || 'Failed to ensure profile' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[badges/track] error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
