import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { resolveEffectiveTier } from '@daftar/shared-types';

const router = express.Router();

/**
 * Plan definitions
 */
const PLAN_TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: null,
    features: [
      'Portfolio Tracker',
      'Transaction History',
      'NFT Gallery',
      '24h PNL Overview',
    ],
    limits: {
      pnlHistory: false,
      analytics: false,
      visualizer: false,
      prioritySupport: false,
      earlyFeatures: false,
    }
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 5,
    interval: 'month',
    features: [
      'Everything in Free',
      'Full PNL History (All Timeframes)',
      'Portfolio Analytics Dashboard',
      'Transaction Visualizer',
      'Advanced Transaction Filters',
      'Priority Support',
      'Early Access to New Features',
      'Pro Badge on Profile',
    ],
    limits: {
      pnlHistory: true,
      analytics: true,
      visualizer: true,
      prioritySupport: true,
      earlyFeatures: true,
    }
  }
];

/**
 * GET /api/plans
 * Returns available plans
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ plans: PLAN_TIERS });
});

/**
 * GET /api/plans/status?wallet=<address>
 * Returns current plan status for a wallet
 */
router.get('/status', async (req: Request, res: Response) => {
  const wallet = (req.query.wallet as string || '').toLowerCase().trim();
  if (!wallet) {
    return res.status(400).json({ error: 'wallet query param required' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('wallet_address, is_verified, subscription_tier, subscription_started_at, subscription_expires_at')
      .eq('wallet_address', wallet)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    // Default to free tier if no profile found
    const profile = data || {
      wallet_address: wallet,
      is_verified: false,
      subscription_tier: 'free',
      subscription_started_at: null,
      subscription_expires_at: null
    };

    const effectiveTier = resolveEffectiveTier(profile);

    const plan = PLAN_TIERS.find(p => p.id === effectiveTier) || PLAN_TIERS[0];

    return res.json({
      wallet,
      tier: effectiveTier,
      plan,
      expiresAt: profile.subscription_expires_at || null,
      startedAt: profile.subscription_started_at || null,
      isActive: effectiveTier !== 'free',
    });
  } catch (err: any) {
    console.error('[Plans] Status check error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
