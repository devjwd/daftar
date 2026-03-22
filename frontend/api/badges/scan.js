/**
 * POST /api/badges/scan
 * Runs badge eligibility adapters and persists awards in Supabase.
 * Admin only (or Vercel Cron secret).
 */
import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '../_lib/auth.js';
import { runAdaptersForAddress } from '../_lib/badgeAdapters/index.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp } from '../_lib/http.js';
import { attestBadgeAllowlistOnChain, getAttestationReadiness } from '../_lib/onchainAttestation.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const isLikelyAddress = (address) => /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

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

const getTrackedAddresses = async (supabase) => {
  const trackedResult = await supabase
    .from('badge_tracked_addresses')
    .select('wallet_address')
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (!trackedResult.error) {
    return Array.from(
      new Set((trackedResult.data || []).map((row) => normalizeAddress(row?.wallet_address)).filter(Boolean))
    );
  }

  // Fallback if dedicated tracking table does not exist yet.
  if (trackedResult.error.code !== '42P01') {
    throw new Error(trackedResult.error.message || 'Failed to load tracked addresses');
  }

  const profilesResult = await supabase
    .from('profiles')
    .select('wallet_address')
    .limit(5000);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message || 'Failed to load tracked addresses from profiles');
  }

  return Array.from(
    new Set((profilesResult.data || []).map((row) => normalizeAddress(row?.wallet_address)).filter(Boolean))
  );
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
      key: `badges:scan:write:${ip}`,
      limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
      windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests' });
    }

    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && req.headers['authorization'] === `Bearer ${cronSecret}`;

    if (!isCron) {
      const auth = checkAdmin(req);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    }

    const supabase = createSupabaseAdmin();
    const { configs: badgeConfigs } = await loadResolvedBadgeConfigs();
    const configByBadgeId = new Map(
      badgeConfigs.map((config) => [String(config?.badgeId || ''), config])
    );

    const bodyAddress = normalizeAddress(req.body?.address || '');
    const useSingleAddress = Boolean(bodyAddress && isLikelyAddress(bodyAddress));

    if (bodyAddress && !useSingleAddress) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const trackedAddresses = useSingleAddress ? [bodyAddress] : await getTrackedAddresses(supabase);
    const readiness = getAttestationReadiness();

    const awarded = [];
    const attestationFailures = [];
    let scanned = 0;

    for (const addr of trackedAddresses) {
      scanned += 1;
      try {
        const candidates = await runAdaptersForAddress(addr, badgeConfigs);
        if (!candidates.length) continue;

        const existingResult = await supabase
          .from('badges')
          .select('badge_id')
          .eq('wallet_address', addr);

        if (existingResult.error) {
          console.warn('[scan] failed loading existing awards', addr, existingResult.error.message);
          continue;
        }

        const existingBadgeIds = new Set(
          (existingResult.data || []).map((row) => String(row?.badge_id || '').trim()).filter(Boolean)
        );

        let xpDelta = 0;

        for (const candidate of candidates) {
          const candidateBadgeId = String(candidate?.badgeId || '').trim();
          if (!candidateBadgeId || existingBadgeIds.has(candidateBadgeId)) continue;

          const config = configByBadgeId.get(candidateBadgeId);
          const resolvedOnChainBadgeId =
            config?.onChainBadgeId ??
            candidate?.extra?.onChainBadgeId ??
            null;

          let attestation = null;
          if (resolvedOnChainBadgeId != null) {
            if (!readiness.ready) {
              attestationFailures.push({
                addr,
                badgeId: candidateBadgeId,
                reason: readiness.reason,
              });
              continue;
            }

            attestation = await attestBadgeAllowlistOnChain({
              ownerAddress: addr,
              onChainBadgeId: resolvedOnChainBadgeId,
            });

            if (!attestation.ok) {
              attestationFailures.push({
                addr,
                badgeId: candidateBadgeId,
                reason: attestation.reason,
              });
              continue;
            }
          }

          const payload = {
            ...(candidate?.extra || {}),
            onChainBadgeId: resolvedOnChainBadgeId,
            attested: Boolean(attestation?.ok),
            attestationTxHash: attestation?.txHash || null,
            attestedAt: attestation ? new Date().toISOString() : null,
            alreadyAllowlisted: Boolean(attestation?.alreadyAllowlisted),
            attestor: attestation?.attestor || null,
          };

          const xpValue = Number(payload?.xpValue ?? payload?.xp_value ?? 0) || 0;
          const insertAward = await supabase
            .from('badges')
            .insert({
              wallet_address: addr,
              badge_id: candidateBadgeId,
              badge_name: String(payload?.badgeName || payload?.badge_name || candidateBadgeId),
              rarity: String(payload?.rarity || 'common'),
              xp_value: xpValue,
              claimed_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (insertAward.error) {
            console.warn('[scan] failed inserting award', addr, candidateBadgeId, insertAward.error.message);
            continue;
          }

          existingBadgeIds.add(candidateBadgeId);
          xpDelta += xpValue;
          awarded.push({
            addr,
            badgeId: candidateBadgeId,
            onChainBadgeId: resolvedOnChainBadgeId,
            attestationTxHash: attestation?.txHash || null,
          });
        }

        const ensureProfile = await supabase
          .from('profiles')
          .upsert(
            {
              wallet_address: addr,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'wallet_address', ignoreDuplicates: true }
          );

        if (ensureProfile.error) {
          console.warn('[scan] failed ensuring profile', addr, ensureProfile.error.message);
          continue;
        }

        if (xpDelta > 0) {
          const profileResult = await supabase
            .from('profiles')
            .select('xp')
            .eq('wallet_address', addr)
            .single();

          if (profileResult.error) {
            console.warn('[scan] failed reading profile xp', addr, profileResult.error.message);
            continue;
          }

          const nextXp = Number(profileResult.data?.xp || 0) + xpDelta;
          const updateXp = await supabase
            .from('profiles')
            .update({ xp: nextXp })
            .eq('wallet_address', addr);

          if (updateXp.error) {
            console.warn('[scan] failed updating xp', addr, updateXp.error.message);
          }
        }
      } catch (error) {
        console.warn('[scan] error scanning', addr, error?.message || error);
      }
    }

    return res.status(200).json({
      scanned,
      awarded: awarded.length,
      awards: awarded,
      attestationFailures,
    });
  } catch (error) {
    console.error('[badges/scan] error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
