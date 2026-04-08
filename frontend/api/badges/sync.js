import { createClient } from '@supabase/supabase-js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getBadgeModuleAddress = () => {
  const raw = String(
    process.env.BADGE_MODULE_ADDRESS ||
      process.env.VITE_BADGE_SBT_MODULE_ADDRESS ||
      process.env.VITE_BADGE_MODULE_ADDRESS ||
      ''
  )
    .trim()
    .toLowerCase();
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

const rarityFromLevel = (level) => {
  const n = Number(level);
  if (n === 5) return 'LEGENDARY';
  if (n === 4) return 'EPIC';
  if (n === 3) return 'RARE';
  if (n === 2) return 'UNCOMMON';
  return 'COMMON';
};

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' };
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

const getBadgeDefinitionRarity = (badgeDefinition, fallbackValue = 'COMMON') => {
  const value = badgeDefinition?.rarity;
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : fallbackValue;
};

const getBadgeDefinitionName = (badgeDefinition, fallbackValue = '') => {
  const value = badgeDefinition?.name ?? badgeDefinition?.badge_name;
  return typeof value === 'string' && value.trim() ? value.trim() : fallbackValue;
};

const getRequestString = (value, fallbackValue = '') => {
  const normalized = String(value || '').trim();
  return normalized || fallbackValue;
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
        function: `${moduleAddress}::badges::get_badge`,
        typeArguments: [],
        functionArguments: [Number(badgeId)],
      },
    });

    if (!Array.isArray(result) || result.length < 9) {
      return { ok: false, badge: null, error: 'Unexpected get_badge response from chain' };
    }

    const [id, name, description, , , , , rarityLevel, xpValue] = result;

    return {
      ok: true,
      badge: {
        badge_id: Number(id),
        badge_name: decodeBytes(name),
        description: decodeBytes(description),
        rarity: rarityFromLevel(rarityLevel),
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

    const supabaseResult = createSupabaseAdmin();
    if (!supabaseResult.ok) {
      return sendJson(res, 500, { error: supabaseResult.error });
    }

    const supabase = supabaseResult.supabase;
    const normalizedBadgeId = String(badgeId || '').trim();
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

    const expectedOnChainBadgeId = getBadgeDefinitionOnChainBadgeId(badgeDefinition);
    if (expectedOnChainBadgeId != null && expectedOnChainBadgeId !== onChainBadgeId) {
      console.error(
        `[badges/sync] on-chain badge mismatch for badgeId ${normalizedBadgeId}: expected ${expectedOnChainBadgeId}, received ${onChainBadgeId}`
      );
      return sendJson(res, 400, { error: 'Badge definition does not match the provided on-chain badge ID' });
    }

    const ownership = await hasBadgeOnChain({ ownerAddress: walletAddress, badgeId: onChainBadgeId });
    if (!ownership.ok) {
      return sendJson(res, 500, { error: ownership.error });
    }

    if (!ownership.owned) {
      return sendJson(res, 400, { error: 'Badge not found on-chain' });
    }

    const badgeDetails = await getBadgeOnChain({ badgeId: onChainBadgeId });
    if (!badgeDetails.ok) {
      return sendJson(res, 500, { error: badgeDetails.error });
    }

    const onChainBadge = badgeDetails.badge;
    const badge = {
      badge_id: normalizedBadgeId,
      badge_name: getBadgeDefinitionName(
        badgeDefinition,
        getRequestString(req.body?.badgeName, onChainBadge.badge_name || `Badge ${normalizedBadgeId}`)
      ),
      rarity: getBadgeDefinitionRarity(
        badgeDefinition,
        getRequestString(req.body?.rarity, onChainBadge.rarity || 'COMMON')
      ),
      xp_value: getBadgeDefinitionXpValue(badgeDefinition, Number(req.body?.xpValue ?? onChainBadge.xp_value ?? 0) || 0),
      on_chain_badge_id: onChainBadge.badge_id,
    };

    const profileUpsert = await supabase
      .from('profiles')
      .upsert(
        {
          wallet_address: walletAddress,
          xp: 0,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_address', ignoreDuplicates: true }
      );

    if (profileUpsert.error) {
      return sendJson(res, 500, { error: profileUpsert.error.message || 'Failed to ensure profile' });
    }

    const existingAttestation = await supabase.from('badge_attestations').select('wallet_address')
      .eq('wallet_address', walletAddress)
      .eq('badge_id', String(badge.badge_id || '').trim())
      .maybeSingle();

    const upsertBadge = await supabase
      .from('badge_definitions')
      .upsert({
        badge_id: badge.badge_id,
        name: badge.badge_name || `Badge ${badge.badge_id}`,
        description: onChainBadge.description || '',
        image_url: badgeDefinition?.image_url ?? badgeDefinition?.imageUrl ?? '',
        rarity: badge.rarity,
        xp_value: badge.xp_value,
        on_chain_badge_id: badge.on_chain_badge_id,
      }, {
        onConflict: 'badge_id',
      });

    if (upsertBadge.error) {
      return sendJson(res, 500, { error: upsertBadge.error.message || 'Failed to upsert badge definition' });
    }

    if (existingAttestation.error) {
      return sendJson(res, 500, { error: existingAttestation.error.message || 'Failed to query existing badge attestation' });
    }

    const verifiedAt = new Date().toISOString();
    const upsertAttestation = await supabase
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

    if (upsertAttestation.error) {
      return sendJson(res, 500, { error: upsertAttestation.error.message || 'Failed to persist badge attestation' });
    }

    const upsertTrackedAddress = await supabase
      .from('badge_tracked_addresses')
      .upsert(
        {
          wallet_address: walletAddress,
          added_at: verifiedAt,
        },
        { onConflict: 'wallet_address' }
      );

    if (upsertTrackedAddress.error) {
      return sendJson(res, 500, { error: upsertTrackedAddress.error.message || 'Failed to persist tracked address' });
    }

    const currentProfile = await supabase
      .from('profiles')
      .select('xp')
      .eq('wallet_address', walletAddress)
      .single();

    if (currentProfile.error) {
      return sendJson(res, 500, { error: currentProfile.error.message || 'Failed to read profile XP' });
    }

    const alreadyHadBadge = Boolean(existingAttestation.data);
    const xpToAdd = alreadyHadBadge ? 0 : Math.max(0, Number(badge.xp_value) || 0);
    const nextXp = Number(currentProfile.data?.xp || 0) + xpToAdd;
    const updateXp = await supabase.from('profiles').update({ xp: nextXp }).eq('wallet_address', walletAddress);

    if (updateXp.error) {
      return sendJson(res, 500, { error: updateXp.error.message || 'Failed to update profile XP' });
    }

    return sendJson(res, 200, {
      success: true,
      alreadySynced: alreadyHadBadge,
      newXp: nextXp,
      badge: {
        id: badge.badge_id,
        name: badge.badge_name,
        rarity: badge.rarity,
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
