import { createClient } from '@supabase/supabase-js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { enforceRateLimitDistributed } from '../_lib/rateLimit.js';
import { normalizeAddress64 } from '../_lib/address.js';

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const TX_HASH_REGEX = /^0x[a-f0-9]{64}$/i;

const normalizeAddress = (value) => normalizeAddress64(value);

const getBadgeModuleAddress = () => {
  const raw = String(process.env.BADGE_MODULE_ADDRESS || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getFullnodeUrl = () => {
  const explicit = String(process.env.MOVEMENT_RPC_URL || '').trim();
  if (explicit) return explicit;

  const network = String(process.env.VITE_NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet'
    ? 'https://testnet.movementnetwork.xyz/v1'
    : 'https://mainnet.movementnetwork.xyz/v1';
};

const createAptosClient = () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: getFullnodeUrl() }));

const hexToString = (hex) => {
  const normalized = String(hex || '').startsWith('0x') ? String(hex).slice(2) : String(hex || '');
  let output = '';
  for (let i = 0; i < normalized.length; i += 2) {
    const code = parseInt(normalized.slice(i, i + 2), 16);
    if (!Number.isNaN(code)) output += String.fromCharCode(code);
  }
  return output;
};

const decodeBytes = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value.startsWith('0x') ? hexToString(value) : value;
  }
  if (Array.isArray(value)) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return String(value);
};

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { ok: true, supabase };
};

const getBadgeDefinitionOnChainBadgeId = (badgeDefinition) => {
  const value = badgeDefinition?.on_chain_badge_id ?? badgeDefinition?.onChainBadgeId;
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue >= 0 ? numericValue : null;
};

const getBadgeDefinitionXpValue = (badgeDefinition, fallbackValue = 0) => {
  const value = badgeDefinition?.xp_value ?? badgeDefinition?.xpValue ?? fallbackValue;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const getBadgeDefinitionName = (badgeDefinition, fallbackValue = '') => {
  const value = badgeDefinition?.name ?? badgeDefinition?.badge_name;
  return typeof value === 'string' && value.trim() ? value.trim() : fallbackValue;
};

const getRequestString = (value, fallbackValue = '') => {
  const normalized = String(value || '').trim();
  return normalized || fallbackValue;
};

const verifyMintTransaction = async ({ walletAddress, txHash }) => {
  if (!TX_HASH_REGEX.test(txHash)) {
    return { ok: false, error: 'Invalid txHash format' };
  }

  const fullnodeUrl = getFullnodeUrl().replace(/\/$/, '');
  const response = await fetch(`${fullnodeUrl}/transactions/by_hash/${txHash}`);
  if (!response.ok) {
    if (response.status === 404) {
      return { ok: false, error: 'Transaction not found on chain' };
    }
    return { ok: false, error: `Failed to fetch transaction (${response.status})` };
  }

  const tx = await response.json();
  const sender = normalizeAddress(tx?.sender);
  if (sender !== walletAddress) {
    return { ok: false, error: 'Transaction sender does not match walletAddress' };
  }

  const successful = tx?.success === true || tx?.success === 'true';
  if (!successful) {
    return { ok: false, error: 'Transaction is not successful' };
  }

  const entryFn = String(tx?.payload?.function || '').trim().toLowerCase();
  const moduleAddress = getBadgeModuleAddress();
  if (moduleAddress && entryFn && !entryFn.startsWith(`${moduleAddress}::badges::`)) {
    return { ok: false, error: 'Transaction is not a badge module call' };
  }

  return { ok: true };
};

const hasBadgeOnChain = async ({ ownerAddress, badgeId }) => {
  const moduleAddress = getBadgeModuleAddress();
  if (!moduleAddress || !ADDRESS_RE.test(moduleAddress)) {
    return { ok: false, owned: false, error: 'BADGE_MODULE_ADDRESS is missing or invalid' };
  }

  try {
    const client = createAptosClient();
    const result = await client.view({
      payload: {
        function: `${moduleAddress}::badges::has_badge`,
        typeArguments: [],
        functionArguments: [ownerAddress, Number(badgeId)],
      },
    });

    return { ok: true, owned: Boolean(result && result[0]) };
  } catch (error) {
    return {
      ok: false,
      owned: false,
      error: String(error?.message || 'On-chain ownership check failed').slice(0, 240),
    };
  }
};

const getBadgeOnChain = async ({ badgeId }) => {
  const moduleAddress = getBadgeModuleAddress();
  if (!moduleAddress || !ADDRESS_RE.test(moduleAddress)) {
    return { ok: false, badge: null, error: 'BADGE_MODULE_ADDRESS is missing or invalid' };
  }

  try {
    const client = createAptosClient();
    const result = await client.view({
      payload: {
        function: `${moduleAddress}::badges::get_badge_info`,
        typeArguments: [],
        functionArguments: [Number(badgeId)],
      },
    });

    if (!Array.isArray(result) || result.length < 9) {
      return { ok: false, badge: null, error: 'Unexpected get_badge_info response from chain' };
    }

    const [name, category, status, , totalMinted, maxSupply, xpValue] = result;

    return {
      ok: true,
      badge: {
        badge_id: Number(badgeId),
        badge_name: decodeBytes(name),
        description: '',
        category: decodeBytes(category),
        status: Number(status) || 0,
        total_minted: Number(totalMinted) || 0,
        max_supply: Number(maxSupply) || 0,
        xp_value: Number(xpValue) || 0,
      },
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      badge: null,
      error: String(error?.message || 'Failed to fetch badge details from chain').slice(0, 240),
    };
  }
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = await enforceRateLimitDistributed({
    key: `badges:sync:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 30),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  try {
    const walletAddress = normalizeAddress(req.body?.walletAddress);
    const badgeId = String(req.body?.badgeId || '').trim();
    const onChainBadgeId = Number(req.body?.onChainBadgeId);
    const txHash = String(req.body?.txHash || '').trim() || null;

    if (!WALLET_REGEX.test(walletAddress)) {
      return sendJson(res, 400, { error: 'Invalid wallet address' });
    }

    if (!badgeId) {
      return sendJson(res, 400, { error: 'badgeId is required' });
    }

    if (!Number.isInteger(onChainBadgeId) || onChainBadgeId < 0) {
      return sendJson(res, 400, { error: 'onChainBadgeId must be a non-negative integer' });
    }

    if (!txHash) {
      return sendJson(res, 400, { error: 'txHash is required' });
    }

    // 1. Verify Transaction On-Chain
    const mintTransaction = await verifyMintTransaction({ walletAddress, txHash });
    if (!mintTransaction.ok) {
      return sendJson(res, 400, { error: mintTransaction.error });
    }

    const supabaseResult = createSupabaseAdmin();
    if (!supabaseResult.ok) {
      return sendJson(res, 500, { error: supabaseResult.error });
    }

    const supabase = supabaseResult.supabase;
    const normalizedBadgeId = String(badgeId ?? '').trim();

    // 2. Fetch Badge Definition (Used for metadata fallback)
    const badgeDefinitionResult = await supabase
      .from('badge_definitions')
      .select('*')
      .eq('badge_id', normalizedBadgeId)
      .maybeSingle();

    if (badgeDefinitionResult.error) {
      return sendJson(res, 500, {
        error: badgeDefinitionResult.error.message || 'Failed to fetch badge definition',
      });
    }

    const badgeDefinition = badgeDefinitionResult.data || null;

    // 3. Verify Badge Ownership On-Chain
    const ownership = await hasBadgeOnChain({ ownerAddress: walletAddress, badgeId: onChainBadgeId });
    if (!ownership.ok) return sendJson(res, 500, { error: ownership.error });
    if (!ownership.owned) return sendJson(res, 400, { error: 'Badge not found on-chain' });

    const badgeDetails = await getBadgeOnChain({ badgeId: onChainBadgeId });
    if (!badgeDetails.ok) return sendJson(res, 500, { error: badgeDetails.error });

    const onChainBadge = badgeDetails.badge;
    const badge = {
      badge_id: normalizedBadgeId,
      badge_name: getBadgeDefinitionName(badgeDefinition, getRequestString(req.body?.badgeName, onChainBadge.badge_name || `Badge ${normalizedBadgeId}`)),
      xp_value: getBadgeDefinitionXpValue(badgeDefinition, Number(req.body?.xpValue ?? onChainBadge.xp_value ?? 0) || 0),
      on_chain_badge_id: onChainBadge.badge_id,
      description: badgeDefinition?.description || getRequestString(req.body?.description, onChainBadge.description || ''),
    };

    // 4. ATOMIC DATABASE UPDATE
    // NOTE: We no longer manually create profiles or calculate XP. 
    // The DB triggers handles everything automatically on Attestation Insert.
    
    // UPSERT Attestation (This triggers sync_user_xp in DB)
    const verifiedAt = new Date().toISOString();
    const { error: attestationError } = await supabase
      .from('badge_attestations')
      .upsert(
        {
          wallet_address: walletAddress,
          badge_id: badge.badge_id,
          eligible: true,
          verified_at: verifiedAt,
          proof_hash: txHash,
        },
        { onConflict: 'wallet_address,badge_id' }
      );

    if (attestationError) {
      return sendJson(res, 500, { error: attestationError.message || 'Failed to persist attestation' });
    }

    // 5. UPDATE CACHES & METADATA (Background-ish updates)
    // NOTE: We no longer allow unauthenticated clients to update badge_definitions.
    // This table should be managed via admin sync paths only to prevent cross-slug corruption.

    // Mark as tracked
    await supabase.from('badge_tracked_addresses').upsert({
      wallet_address: walletAddress,
      added_at: verifiedAt,
    }, { onConflict: 'wallet_address' });

    // 6. Return Final Profile State
    const { data: profileData } = await supabase
      .from('profiles')
      .select('xp')
      .eq('wallet_address', walletAddress)
      .single();

    return sendJson(res, 200, {
      success: true,
      newXp: Number(profileData?.xp || 0),
      badge: {
        id: badge.badge_id,
        name: badge.badge_name,
        xpValue: badge.xp_value,
      },
    });

  } catch (error) {
    console.error('[badges/sync] request failed', error);
    return sendJson(res, 500, {
      error: String(error?.message || 'Internal server error').slice(0, 240),
    });
  }
}
