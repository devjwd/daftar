import express, { Request, Response } from 'express';
import { 
  badgeLimiter, 
  awardLimiter, 
  forceRefreshLimiter 
} from '../middleware/rateLimit.ts';
import { evaluateRule, getSignerEpoch, verifyOnChainMint } from '../services/evaluationService.ts';
import { signMintAuthorization } from '../services/signingService.ts';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { BadgeDefinition } from '@daftar/types';

const router = express.Router();

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let badgeCache: { data: any, timestamp: number } | null = null;

/**
 * GET /api/badges
 * List all active and public badge definitions
 */
router.get('/', badgeLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  const includePrivate = req.query.includePrivate === 'true';
  const includeInactive = req.query.includeInactive === 'true';

  // Check Cache
  if (!includePrivate && !includeInactive && badgeCache && (Date.now() - badgeCache.timestamp < CACHE_TTL)) {
    return res.status(200).json(badgeCache.data);
  }

  try {
    let query = supabaseAdmin
      .from('badge_definitions')
      .select('*')
      .eq('is_deleted', false);

    if (!includePrivate) {
      query = query.eq('is_public', true);
    }
    
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('xp_value', { ascending: false });

    if (error) throw error;

    // Update Cache (only for public active badges)
    if (!includePrivate && !includeInactive) {
      badgeCache = { data, timestamp: Date.now() };
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[Badges] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch badges' });
  }
});


/**
 * POST /api/badges/award
 * Evaluate eligibility and provide a signed mint authorization
 */
router.post('/award', awardLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const { badgeId, walletAddress } = req.body;
  const normalizedAddr = normalizeAddress(walletAddress);

  if (!badgeId || !normalizedAddr) {
    return res.status(400).json({ error: 'badgeId and walletAddress are required' });
  }

  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // 1. Fetch badge definition
    const { data: badge, error: bError } = await supabaseAdmin
      .from('badge_definitions')
      .select('*')
      .eq('badge_id', badgeId)
      .maybeSingle();

    const badgeDef = badge as BadgeDefinition;

    if (bError || !badgeDef) return res.status(404).json({ error: 'Badge not found' });
    if (!badgeDef.is_active) return res.status(403).json({ error: 'Badge is currently disabled' });
    if (badgeDef.on_chain_badge_id == null) return res.status(500).json({ error: 'Badge is not configured on-chain' });

    // 2. Fetch existing eligibility/attestation
    const { data: attestation } = await supabaseAdmin
      .from('badge_attestations')
      .select('*')
      .eq('badge_id', badgeDef.badge_id)
      .eq('wallet_address', normalizedAddr)
      .maybeSingle();

    // 3. Evaluate eligibility (Forcing LIVE check for signature generation)
    const evaluation = await evaluateRule(supabaseAdmin, normalizedAddr, badgeDef, null);

    if (!evaluation.eligible) {
      return res.status(403).json({
        eligible: false,
        reason: evaluation.reason,
        error: evaluation.error || 'You do not meet the criteria for this badge'
      });
    }

    // 4. Generate Signature
    const validUntil = Math.floor(Date.now() / 1000) + (3 * 60); // 3 minutes
    const signerEpoch = await getSignerEpoch();
    const nonce = Date.now(); 

    const sigResult = await signMintAuthorization(
      CONFIG.SIGNER.PRIVATE_KEY,
      CONFIG.SIGNER.MODULE_ADDRESS,
      normalizedAddr,
      badgeDef.on_chain_badge_id,
      validUntil,
      signerEpoch,
      nonce
    );

    // 5. Update or create attestation in DB
    await supabaseAdmin
      .from('badge_attestations')
      .upsert({
        badge_id: badgeDef.badge_id,
        wallet_address: normalizedAddr,
        eligible: true,
        verified_at: new Date().toISOString(),
        proof_hash: `sig:${nonce}`,
        updated_at: new Date().toISOString()
      }, { onConflict: 'badge_id, wallet_address' });

    return res.status(200).json({
      eligible: true,
      ...sigResult,
      nonce,
      badge_id: badgeDef.on_chain_badge_id,
      user_address: normalizedAddr
    });

  } catch (err: any) {
    console.error('[Badges/Award] Error:', err);
    return res.status(500).json({ error: err.message || 'Evaluation failed' });
  }
});

/**
 * GET /api/badges/eligibility
 * Check if a user is eligible for a badge without generating a signature
 */
router.get('/eligibility', badgeLimiter, forceRefreshLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const { badgeId, wallet, force } = req.query;
  const normalizedAddr = normalizeAddress(wallet as string);
  const bypassCache = force === 'true';

  if (!badgeId || !normalizedAddr) {
    return res.status(400).json({ error: 'badgeId and wallet are required' });
  }

  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // 1. Fetch badge definition
    const { data: badge, error: bError } = await supabaseAdmin
      .from('badge_definitions')
      .select('*')
      .eq('badge_id', badgeId)
      .maybeSingle();

    if (bError || !badge) return res.status(404).json({ error: 'Badge not found' });

    // 2. Fetch existing attestation
    const { data: attestation } = await supabaseAdmin
      .from('badge_attestations')
      .select('*')
      .eq('badge_id', badge.badge_id)
      .eq('wallet_address', normalizedAddr)
      .maybeSingle();

    // 3. Evaluate (with cache awareness)
    const evaluation = await evaluateRule(supabaseAdmin, normalizedAddr, badge, bypassCache ? null : attestation);

    // 4. If newly found eligible, persist to DB for future caching
    if (evaluation.eligible && !evaluation.fromCache) {
      await supabaseAdmin.from('badge_attestations').upsert({
        badge_id: badge.badge_id,
        wallet_address: normalizedAddr,
        eligible: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'badge_id, wallet_address' });
    }

    return res.status(200).json(evaluation);
  } catch (err: any) {
    console.error('[Badges/Eligibility] Error:', err);
    return res.status(500).json({ error: err.message || 'Evaluation failed' });
  }
});

/**
 * GET /api/badges/eligibility/bulk
 * Bulk check eligibility for all active badges
 */
router.get('/eligibility/bulk', badgeLimiter, forceRefreshLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const { wallet, force } = req.query;
  const normalizedAddr = normalizeAddress(wallet as string);
  const bypassCache = force === 'true';

  if (!normalizedAddr) {
    return res.status(400).json({ error: 'wallet address is required' });
  }

  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // 1. Fetch all active badges
    const { data: badges, error: bError } = await supabaseAdmin
      .from('badge_definitions')
      .select('*')
      .eq('is_active', true)
      .eq('is_deleted', false);

    if (bError) throw bError;

    // 2. Fetch all existing attestations for this user
    const { data: attestations } = await supabaseAdmin
      .from('badge_attestations')
      .select('*')
      .eq('wallet_address', normalizedAddr);

    const attestationMap = new Map((attestations || []).map(a => [a.badge_id, a]));

    // 3. Evaluate each badge
    const results = await Promise.all((badges || []).map(async (badge) => {
      const attestation = attestationMap.get(badge.badge_id);
      const evaluation = await evaluateRule(supabaseAdmin, normalizedAddr, badge, bypassCache ? null : attestation);
      
      // 4. Background persist if newly eligible (don't await for speed, but catch errors)
      if (evaluation.eligible && !evaluation.fromCache) {
        supabaseAdmin.from('badge_attestations').upsert({
          badge_id: badge.badge_id,
          wallet_address: normalizedAddr,
          eligible: true,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'badge_id, wallet_address' }).then(({ error }) => {
          if (error) console.error(`[Badges/Bulk] Failed to cache eligibility for ${badge.badge_id}:`, error.message);
        });
      }

      return {
        badge_id: badge.badge_id,
        ...evaluation
      };
    }));

    return res.status(200).json({ results });
  } catch (err: any) {
    console.error('[Badges/Eligibility/Bulk] Error:', err);
    return res.status(500).json({ error: err.message || 'Bulk evaluation failed' });
  }
});

/**
 * GET /api/badges/user/:address
 * Get all badges earned by a user
 */
router.get('/user/:address', badgeLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const address = normalizeAddress(req.params.address as string);
  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('badge_attestations')
      .select(`
        *,
        badge:badge_definitions(*)
      `)
      .eq('wallet_address', address)
      .eq('eligible', true);

    if (error) throw error;

    const awards = (data || []).map(a => ({
      badgeId: a.badge_id,
      awardedAt: a.verified_at || a.created_at,
      txHash: a.proof_hash?.startsWith('0x') ? a.proof_hash : null,
      metadata: a.metadata || {},
      badge: a.badge
    }));

    return res.status(200).json({ awards });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user awards' });
  }
});

/**
 * POST /api/badges/sync
 * Record an on-chain mint event
 */
router.post('/sync', awardLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const { walletAddress, badgeId, onChainBadgeId, txHash, xpValue } = req.body;
  const normalizedAddr = normalizeAddress(walletAddress);

  if (!normalizedAddr || (!badgeId && !onChainBadgeId)) {
    return res.status(400).json({ error: 'Missing required sync data' });
  }

    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  
    // 0. Verify on-chain (Mandatory for XP)
    if (onChainBadgeId && txHash && txHash.startsWith('0x')) {
      const isValid = await verifyOnChainMint(txHash, normalizedAddr, onChainBadgeId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid transaction hash. On-chain verification failed.' });
      }
    } else if (xpValue && xpValue > 0) {
      // If XP is being awarded, we MUST have a verifiable TX
      return res.status(400).json({ error: 'Transaction hash and on-chain ID are required to award XP.' });
    }
  
    try {
      // 1. Ensure profile exists to hold XP
      await supabaseAdmin.from('profiles').upsert({
        wallet_address: normalizedAddr,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' });

    // 2. Record attestation / ownership
    // Standardizing: we put txHash in metadata to trigger the DB sync_user_xp logic
    const { error } = await supabaseAdmin
      .from('badge_attestations')
      .upsert({
        badge_id: badgeId,
        wallet_address: normalizedAddr,
        eligible: true,
        verified_at: new Date().toISOString(),
        proof_hash: txHash,
        metadata: { txHash }, 
        updated_at: new Date().toISOString()
      }, { onConflict: 'badge_id, wallet_address' });

    if (error) throw error;

    return res.status(200).json({ ok: true, synced: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

/**
 * GET /api/badges/:id
 * Get a specific badge definition
 */
router.get('/:id', badgeLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('badge_definitions')
      .select('*')
      .eq('badge_id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Badge not found' });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch badge' });
  }
});

/**
 * GET /api/badges/holders/:id
 */
router.get('/holders/:id', badgeLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('badge_attestations')
      .select('wallet_address, verified_at, proof_hash')
      .eq('badge_id', req.params.id)
      .eq('eligible', true)
      .order('verified_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return res.status(200).json({ holders: data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch holders' });
  }
});

export default router;