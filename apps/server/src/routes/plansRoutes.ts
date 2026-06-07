import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { resolveEffectiveTier } from '@daftar/shared-types';
import { normalizeAddress } from '../utils/address.ts';
import { queueSync } from '../services/analyticsSyncQueue.ts';
import CONFIG from '../config/index.ts';

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

// ---------------------------------------------------------------------------
// Helper: read all subscription config keys from system_config table
// ---------------------------------------------------------------------------
async function getSubscriptionConfig(supabase: any) {
  const { data } = await supabase
    .from('system_config')
    .select('key, value')
    .in('key', [
      'subscription_price_usd',
      'subscription_discount_price_usd',
      'subscription_discount_label',
      'subscription_treasury_wallet',
      'subscription_duration_days',
    ]);

  const cfg: Record<string, any> = {};
  (data || []).forEach((row: any) => { cfg[row.key] = row.value; });

  // jsonb values may come back as JS string, number, or null depending on
  // how they were stored. Normalise each into the expected type.
  const toNum = (v: any, fallback: number) => {
    if (v === null || v === undefined) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };
  const toStr = (v: any) => (v === null || v === undefined ? '' : String(v));

  const rawDiscount = cfg.subscription_discount_price_usd;
  const hasDiscount = rawDiscount !== null && rawDiscount !== undefined && rawDiscount !== '' && rawDiscount !== 0;

  return {
    basePriceUsd:     toNum(cfg.subscription_price_usd, 5),
    discountPriceUsd: hasDiscount ? toNum(rawDiscount, 0) : null,
    discountLabel:    toStr(cfg.subscription_discount_label),
    treasuryWallet:   toStr(cfg.subscription_treasury_wallet),
    durationDays:     toNum(cfg.subscription_duration_days, 30),
  };
}

// ---------------------------------------------------------------------------
// Helper: fetch current MOVE price from price_cache
// ---------------------------------------------------------------------------
async function getMovePriceUsd(supabase: any): Promise<number> {
  const MOVE_IDS = ['0x1', '0xa'];
  const { data } = await supabase
    .from('price_cache')
    .select('price_usd')
    .in('token_id', MOVE_IDS)
    .order('cached_at', { ascending: false })
    .limit(1);

  const price = data?.[0]?.price_usd;
  return price ? Number(price) : 0;
}

/**
 * GET /api/plans/config
 * Public — returns live pricing config + current MOVE/USD price.
 */
router.get('/config', async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

  try {
    const [cfg, movePriceUsd] = await Promise.all([
      getSubscriptionConfig(supabase),
      getMovePriceUsd(supabase),
    ]);

    return res.json({ ...cfg, movePriceUsd });
  } catch (err: any) {
    console.error('[Plans] Config fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plans/verify-payment
 * Verifies an on-chain MOVE transfer and upgrades the user's subscription tier.
 * Body: { walletAddress, txHash }
 */
router.post('/verify-payment', async (req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

  const walletAddress = normalizeAddress((req.body.walletAddress as string) || '');
  const txHash = ((req.body.txHash as string) || '').trim();

  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });
  if (!txHash) return res.status(400).json({ error: 'txHash required' });

  try {
    // 1. Load pricing config
    const [cfg, movePriceUsd] = await Promise.all([
      getSubscriptionConfig(supabase),
      getMovePriceUsd(supabase),
    ]);

    if (!cfg.treasuryWallet) {
      return res.status(503).json({ error: 'Subscription payments are not configured yet. Contact the admin.' });
    }

    if (movePriceUsd <= 0) {
      return res.status(503).json({ error: 'MOVE price unavailable. Please try again shortly.' });
    }

    const effectivePriceUsd = cfg.discountPriceUsd !== null ? cfg.discountPriceUsd : cfg.basePriceUsd;
    // MOVE has 8 decimals (1 MOVE = 1e8 octas)
    const MOVE_DECIMALS = 1e8;
    const requiredMoveAmount = effectivePriceUsd / movePriceUsd; // in MOVE
    const requiredOctas = Math.floor(requiredMoveAmount * MOVE_DECIMALS);

    // 2. Prevent duplicate activations — check if this txHash was already used
    const { data: existingPayment } = await supabase
      .from('subscription_payments')
      .select('id')
      .eq('tx_hash', txHash)
      .maybeSingle();

    if (existingPayment) {
      return res.status(409).json({ error: 'This transaction has already been used to activate a subscription.' });
    }

    // 3. Verify the transaction on-chain via Movement RPC
    const rpcUrl = CONFIG.MOVEMENT.RPC_URL;
    const txUrl = `${rpcUrl}/transactions/by_hash/${encodeURIComponent(txHash)}`;
    const txResponse = await fetch(txUrl);

    if (!txResponse.ok) {
      return res.status(400).json({ error: `Transaction not found on-chain (${txResponse.status}). Make sure the transaction is confirmed.` });
    }

    const tx: any = await txResponse.json();

    if (!tx.success) {
      return res.status(400).json({ error: 'Transaction failed on-chain. Only successful transactions are accepted.' });
    }

    // 4. Validate sender
    const txSender = normalizeAddress(tx.sender || '');
    if (txSender !== walletAddress) {
      return res.status(400).json({ error: 'Transaction sender does not match the provided wallet address.' });
    }

    // 5. Validate the payload — must be a coin transfer to the treasury wallet
    const payload = tx.payload || {};
    const fn: string = (payload.function || '').toLowerCase();
    const isCoinTransfer =
      fn === '0x1::aptos_account::transfer' ||
      fn === '0x1::coin::transfer';

    if (!isCoinTransfer) {
      return res.status(400).json({ error: 'Transaction is not a valid MOVE transfer. Expected 0x1::aptos_account::transfer.' });
    }

    const args: any[] = payload.arguments || [];
    const txRecipient = normalizeAddress(String(args[0] || ''));
    const treasury = normalizeAddress(cfg.treasuryWallet);

    if (txRecipient !== treasury) {
      return res.status(400).json({ error: `Payment must be sent to the treasury wallet. Expected: ${cfg.treasuryWallet}` });
    }

    // 6. Validate amount (allow 2% tolerance for price fluctuation)
    const txOctas = Number(args[1] || 0);
    const tolerance = 0.02; // 2%
    const minAcceptableOctas = Math.floor(requiredOctas * (1 - tolerance));

    if (txOctas < minAcceptableOctas) {
      const sentMove = (txOctas / MOVE_DECIMALS).toFixed(4);
      const neededMove = (minAcceptableOctas / MOVE_DECIMALS).toFixed(4);
      return res.status(400).json({
        error: `Insufficient payment. Sent ${sentMove} MOVE but ${neededMove} MOVE is required (2% tolerance applied).`,
      });
    }

    // 7. All checks passed — upgrade the subscription
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.durationDays * 24 * 60 * 60 * 1000);

    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .upsert({
        wallet_address: walletAddress,
        subscription_tier: 'pro',
        is_verified: true,
        subscription_started_at: now.toISOString(),
        subscription_expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (updateError) throw updateError;

    // 8. Record the payment to prevent replay
    try {
      await supabase.from('subscription_payments').insert({
        wallet_address: walletAddress,
        tx_hash: txHash,
        amount_octas: txOctas,
        price_usd: effectivePriceUsd,
        move_price_usd: movePriceUsd,
        duration_days: cfg.durationDays,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
      });
    } catch (recordErr: any) {
      // Non-fatal — subscription is already upgraded
      console.warn('[Plans] Failed to record payment receipt:', recordErr.message);
    }

    // 9. Queue analytics sync
    try {
      await supabase.from('user_sync_status').upsert({
        user_address: walletAddress,
        full_history_synced: false,
        synced_transactions: 0,
        total_transactions: 0,
        last_sync_at: now.toISOString(),
      }, { onConflict: 'user_address' });

      await queueSync(supabase, walletAddress, 10);
    } catch (syncErr: any) {
      console.warn('[Plans] Failed to queue sync after payment:', syncErr.message);
    }

    console.log(`[Plans] Payment verified. Upgraded ${walletAddress} to Pro until ${expiresAt.toISOString()}`);

    return res.json({
      ok: true,
      tier: 'pro',
      expiresAt: expiresAt.toISOString(),
      durationDays: cfg.durationDays,
    });
  } catch (err: any) {
    console.error('[Plans] Verify payment error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
