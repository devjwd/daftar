/**
 * State management — Supabase only.
 * All badge awards, tracked addresses, badge configs and definitions
 * are stored in Supabase tables. Vercel Blob is no longer used.
 */
import { getSupabaseAdmin } from '../badges/supabase.js';

const MAX_SAVE_RETRIES = 3;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  const prefixed = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (ADDRESS_RE.test(prefixed)) return prefixed;

  // Keep legacy/non-hex identifiers untouched so we do not drop existing data.
  return raw;
};



const normalizeTrackedAddresses = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => normalizeAddress(entry)).filter(Boolean)));
};

const normalizeAwardsList = (value) => {
  if (!Array.isArray(value)) return [];

  const byBadgeId = new Map();
  for (const item of value) {
    const badgeId = String(item?.badgeId || '').trim();
    if (!badgeId) continue;

    const existing = byBadgeId.get(badgeId);
    if (!existing) {
      byBadgeId.set(badgeId, item);
      continue;
    }

    const existingTs = Date.parse(existing?.awardedAt || '') || 0;
    const itemTs = Date.parse(item?.awardedAt || '') || 0;
    if (itemTs >= existingTs) {
      byBadgeId.set(badgeId, item);
    }
  }

  return Array.from(byBadgeId.values());
};

const normalizeUserAwards = (value) => {
  if (!isObject(value)) return {};

  const out = {};
  for (const [addr, awards] of Object.entries(value)) {
    const normalizedAddr = normalizeAddress(addr);
    if (!normalizedAddr) continue;
    out[normalizedAddr] = normalizeAwardsList(awards);
  }
  return out;
};

const normalizeBadgeConfigs = (value) => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map();
  for (const entry of value) {
    const badgeId = String(entry?.badgeId || '').trim();
    const rule = Number(entry?.rule);
    if (!badgeId || !Number.isFinite(rule) || rule <= 0) continue;

    deduped.set(badgeId, {
      badgeId,
      rule,
      params: isObject(entry?.params) ? entry.params : {},
      onChainBadgeId:
        entry?.onChainBadgeId == null || entry?.onChainBadgeId === ''
          ? null
          : Number(entry.onChainBadgeId),
    });
  }

  return Array.from(deduped.values());
};

const normalizeBadgeDefinitions = (value) => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map();
  for (const entry of value) {
    if (!isObject(entry)) continue;

    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    if (!id || !name) continue;

    deduped.set(id, {
      ...entry,
      id,
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      imageUrl: typeof entry.imageUrl === 'string' ? entry.imageUrl : '',
      xp: Number(entry.xp) || 0,
      mintFee: Number(entry.mintFee) || 0,
      criteria: Array.isArray(entry.criteria) ? entry.criteria : [],
      metadata: isObject(entry.metadata) ? entry.metadata : {},
      isPublic: entry.isPublic !== false,
      enabled: entry.enabled !== false,
      onChainBadgeId:
        entry?.onChainBadgeId == null || entry?.onChainBadgeId === ''
          ? null
          : Number(entry.onChainBadgeId),
      createdAt: entry.createdAt || null,
      updatedAt: entry.updatedAt || null,
    });
  }

  return Array.from(deduped.values());
};

const mergeStates = (left, right) => {
  const leftAwards = normalizeUserAwards(left?.userAwards);
  const rightAwards = normalizeUserAwards(right?.userAwards);

  const mergedAwards = { ...leftAwards };
  for (const [addr, awards] of Object.entries(rightAwards)) {
    mergedAwards[addr] = normalizeAwardsList([...(leftAwards[addr] || []), ...awards]);
  }

  const hasRightBadgeConfigs =
    right && Object.prototype.hasOwnProperty.call(right, 'badgeConfigs');
  const hasRightBadgeDefinitions =
    right && Object.prototype.hasOwnProperty.call(right, 'badgeDefinitions');

  return {
    userAwards: mergedAwards,
    trackedAddresses: normalizeTrackedAddresses([
      ...(left?.trackedAddresses || []),
      ...(right?.trackedAddresses || []),
    ]),
    badgeConfigs: hasRightBadgeConfigs
      ? normalizeBadgeConfigs(right?.badgeConfigs)
      : normalizeBadgeConfigs(left?.badgeConfigs),
    badgeDefinitions: hasRightBadgeDefinitions
      ? normalizeBadgeDefinitions(right?.badgeDefinitions)
      : normalizeBadgeDefinitions(left?.badgeDefinitions),
  };
};

const stateContains = (container, subset) => {
  const containerState = mergeStates({}, container || {});
  const subsetState = mergeStates({}, subset || {});

  const trackedSet = new Set(containerState.trackedAddresses);
  for (const addr of subsetState.trackedAddresses) {
    if (!trackedSet.has(addr)) return false;
  }

  for (const [addr, subsetAwards] of Object.entries(subsetState.userAwards)) {
    const containerAwards = containerState.userAwards[addr] || [];
    const containerBadgeIds = new Set(containerAwards.map((item) => String(item?.badgeId || '')));

    for (const award of subsetAwards) {
      if (!containerBadgeIds.has(String(award?.badgeId || ''))) return false;
    }
  }

  const containerBadgeIds = new Set(
    (containerState.badgeConfigs || []).map((entry) => String(entry?.badgeId || ''))
  );
  for (const entry of subsetState.badgeConfigs || []) {
    if (!containerBadgeIds.has(String(entry?.badgeId || ''))) return false;
  }

  const containerDefinitionIds = new Set(
    (containerState.badgeDefinitions || []).map((entry) => String(entry?.id || ''))
  );
  for (const entry of subsetState.badgeDefinitions || []) {
    if (!containerDefinitionIds.has(String(entry?.id || ''))) return false;
  }

  return true;
};

const mergeCurrentState = (supabaseState) => ({
  userAwards: normalizeUserAwards(supabaseState?.userAwards),
  trackedAddresses: normalizeTrackedAddresses(supabaseState?.trackedAddresses || []),
  badgeConfigs: normalizeBadgeConfigs(supabaseState?.badgeConfigs || []),
  badgeDefinitions: normalizeBadgeDefinitions(supabaseState?.badgeDefinitions || []),
});

const loadSupabaseState = async () => {
  const supabase = getSupabaseAdmin();

  // Load awards from badge_attestations
  const { data: attestations, error: attestError } = await supabase
    .from('badge_attestations')
    .select('wallet_address, badge_id, verified_at, proof_hash')
    .eq('eligible', true);

  if (attestError) throw attestError;

  const userAwards = {};
  const trackedAddresses = [];

  for (const row of Array.isArray(attestations) ? attestations : []) {
    const walletAddress = normalizeAddress(row?.wallet_address);
    const badgeId = String(row?.badge_id || '').trim();
    if (!walletAddress || !badgeId) continue;

    trackedAddresses.push(walletAddress);
    userAwards[walletAddress] = userAwards[walletAddress] || [];
    userAwards[walletAddress].push({
      badgeId,
      awardedAt: row?.verified_at || null,
      payload: {
        eligible: true,
        proofHash: row?.proof_hash || null,
      },
    });
  }

  // Load badge configs from badge_configs table
  const { data: configRows } = await supabase
    .from('badge_configs')
    .select('badge_id, rule, params, on_chain_badge_id');

  const badgeConfigs = normalizeBadgeConfigs(
    Array.isArray(configRows)
      ? configRows.map((r) => ({
          badgeId: r.badge_id,
          rule: r.rule,
          params: r.params || {},
          onChainBadgeId: r.on_chain_badge_id ?? null,
        }))
      : []
  );

  // Load badge definitions from badge_definitions table
  const { data: defRows } = await supabase
    .from('badge_definitions')
    .select('badge_id, name, description, image_url, xp_value, mint_fee, criteria, metadata, is_public, enabled, on_chain_badge_id, created_at, updated_at');

  const badgeDefinitions = normalizeBadgeDefinitions(
    Array.isArray(defRows)
      ? defRows.map((r) => ({
          id: r.badge_id,
          name: r.name,
          description: r.description || '',
          imageUrl: r.image_url || '',
          xp: Number(r.xp_value) || 0,
          mintFee: Number(r.mint_fee) || 0,
          criteria: Array.isArray(r.criteria) ? r.criteria : [],
          metadata: r.metadata || {},
          isPublic: r.is_public !== false,
          enabled: r.enabled !== false,
          onChainBadgeId: r.on_chain_badge_id ?? null,
          createdAt: r.created_at || null,
          updatedAt: r.updated_at || null,
        }))
      : []
  );

  return {
    userAwards: normalizeUserAwards(userAwards),
    trackedAddresses: normalizeTrackedAddresses(trackedAddresses),
    badgeConfigs,
    badgeDefinitions,
  };
};

/**
 * Returns { userAwards, trackedAddresses, badgeConfigs, badgeDefinitions }
 */
export async function loadState() {
  try {
    return mergeCurrentState(await loadSupabaseState());
  } catch (error) {
    console.error('[state] loadState failed', error?.message || error);
    return { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };
  }
}

/**
 * Saves state to Supabase. All writes go to Supabase tables directly.
 */
export async function saveState(userAwards, trackedAddresses, badgeConfigs, badgeDefinitions) {
  let intended = mergeStates({}, {
    userAwards,
    trackedAddresses,
    ...(badgeConfigs !== undefined ? { badgeConfigs } : {}),
    ...(badgeDefinitions !== undefined ? { badgeDefinitions } : {}),
  });

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt += 1) {
    let latest = { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };
    try {
      latest = await loadSupabaseState();
    } catch (error) {
      console.warn('[state] loadSupabaseState failed during saveState', error?.message || error);
    }

    const merged = mergeStates(latest, intended);
    const supabase = getSupabaseAdmin();

    // --- upsert badge attestations ---
    const verifiedAt = new Date().toISOString();
    const attestationRows = Object.entries(merged.userAwards).flatMap(([walletAddress, awards]) =>
      (Array.isArray(awards) ? awards : [])
        .map((award) => {
          const badgeId = String(award?.badgeId || '').trim();
          if (!walletAddress || !badgeId) return null;
          return {
            wallet_address: walletAddress,
            badge_id: badgeId,
            eligible: true,
            verified_at: award?.awardedAt || verifiedAt,
            proof_hash: String(award?.payload?.proofHash || `${walletAddress}:${badgeId}:${verifiedAt}`),
          };
        })
        .filter(Boolean)
    );

    if (attestationRows.length > 0) {
      const { error } = await supabase
        .from('badge_attestations')
        .upsert(attestationRows, { onConflict: 'wallet_address,badge_id' });
      if (error) console.error('[state] attestation upsert failed', error);
    }

    // --- upsert badge_configs ---
    if (merged.badgeConfigs.length > 0) {
      const configRows = merged.badgeConfigs.map((c) => ({
        badge_id: c.badgeId,
        rule: c.rule,
        params: c.params || {},
        on_chain_badge_id: c.onChainBadgeId ?? null,
        updated_at: verifiedAt,
      }));
      const { error } = await supabase
        .from('badge_configs')
        .upsert(configRows, { onConflict: 'badge_id' });
      if (error) console.error('[state] badge_configs upsert failed', error);
    }

    // --- upsert badge_definitions ---
    if (merged.badgeDefinitions.length > 0) {
      const defRows = merged.badgeDefinitions.map((d) => ({
        badge_id: d.id,
        name: d.name,
        description: d.description || '',
        image_url: d.imageUrl || '',
        xp_value: Number(d.xp) || 0,
        mint_fee: Number(d.mintFee) || 0,
        criteria: Array.isArray(d.criteria) ? d.criteria : [],
        metadata: d.metadata || {},
        is_public: d.isPublic !== false,
        enabled: d.enabled !== false,
        on_chain_badge_id: d.onChainBadgeId ?? null,
        updated_at: verifiedAt,
      }));
      const { error } = await supabase
        .from('badge_definitions')
        .upsert(defRows, { onConflict: 'badge_id' });
      if (error) console.error('[state] badge_definitions upsert failed', error);
    }

    // Verify the save was complete
    let confirmed = { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };
    try {
      confirmed = await loadSupabaseState();
    } catch (error) {
      console.warn('[state] confirmation read failed', error?.message || error);
    }

    if (stateContains(confirmed, intended)) return;
    intended = mergeStates(intended, confirmed);
  }

  console.warn('[state] saveState may have partial overlap due to concurrent writes');
}
