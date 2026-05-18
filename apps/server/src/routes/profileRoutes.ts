import express, { Request, Response } from 'express';
import { normalizeAddress } from '../utils/address.ts';
import { profileLimiter, generalLimiter } from '../middleware/rateLimit.ts';
import { checkRateLimit, checkAndBurnNonce, getNextNonce } from '../services/dbService.ts';
import { verifyWalletSignature } from '../utils/crypto.ts';
import { SupabaseClient } from '@supabase/supabase-js';

const router = express.Router();

/**
 * GET /api/profiles/nonce
 * Get next nonce for a wallet
 */
router.get('/nonce', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const address = normalizeAddress(req.query.address as string);

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const nonce = await getNextNonce(supabaseAdmin, address);
    return res.status(200).json({ nonce });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

/**
 * GET /api/profiles/:address
 */
router.get('/:address', profileLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const address = normalizeAddress(req.params.address);

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('wallet_address', address)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profile not found' });

    return res.status(200).json({
      ...data,
      address: data.wallet_address
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});


/**
 * POST /api/profiles
 * Upsert profile with signature verification
 */
router.post('/', async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const { walletAddress, address, username, bio, twitter, telegram, avatarUrl, signature, signedMessage, nonce } = req.body;
  const normalizedAddr = normalizeAddress(walletAddress || address);

  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid address' });
  if (!signature || !signedMessage) return res.status(401).json({ error: 'Signature required' });

  // Rate Limit
  const rateLimit = await checkRateLimit(supabaseAdmin, `profile_up:${normalizedAddr}`, 60000, 5);
  if (!rateLimit.ok) return res.status(429).json({ error: 'Too many updates' });

  // Nonce check
  if (nonce) {
    const nonceCheck = await checkAndBurnNonce(supabaseAdmin, normalizedAddr, nonce);
    if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });
  }

  // Signature verification
  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({
        wallet_address: normalizedAddr,
        username: username || '',
        bio: bio || '',
        avatar_url: avatarUrl || null,
        twitter: twitter || '',
        telegram: telegram || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

/**
 * GET /api/profiles (Search)
 */
router.get('/', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const query = req.query.query as string;
  const limit = Math.min(parseInt((req.query.limit as string) || '20'), 50);

  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    let supabaseQuery = supabaseAdmin.from('profiles').select('*').limit(limit);

    if (query) {
      const sanitized = String(query).replace(/[^a-zA-Z0-9\s\-_x]/g, '').slice(0, 100);
      if (sanitized) {
        const isAddressSearch = sanitized.toLowerCase().startsWith('0x');
        if (isAddressSearch) {
          supabaseQuery = supabaseQuery.or(`username.ilike.%${sanitized}%,wallet_address.ilike.%${sanitized}%`);
        } else {
          supabaseQuery = supabaseQuery.ilike('username', `%${sanitized}%`);
        }
      }
    }

    const { data, error } = await supabaseQuery;
    if (error) throw error;

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: 'Search failed' });
  }
});

export default router;

