/**
 * Vercel Blob state helpers.
 * Reads and writes badge state (user awards + tracked addresses) as a single
 * JSON blob named "badge-state.json" in the connected Blob store.
 *
 * BLOB_READ_WRITE_TOKEN is automatically injected by Vercel when Blob storage
 * is linked to the project; no manual configuration required.
 */
import { put, list } from '@vercel/blob';

const BLOB_PATHNAME = 'badge-state.json';
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

const pickNewestBlob = (blobs = []) => {
  if (!Array.isArray(blobs) || blobs.length === 0) return null;

  return blobs
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.uploadedAt || 0).getTime() || 0;
      const tb = new Date(b.uploadedAt || 0).getTime() || 0;
      return tb - ta;
    })[0];
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
      category: typeof entry.category === 'string' ? entry.category : 'activity',
      rarity: typeof entry.rarity === 'string' ? entry.rarity : 'COMMON',
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

/**
 * Returns { userAwards: { [address]: [{badgeId,payload,awardedAt},...] },
 *           trackedAddresses: string[] }
 */
export async function loadState() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 20 });
    const newest = pickNewestBlob(blobs);
    if (!newest) return { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };

    const res = await fetch(newest.url);
    if (!res.ok) return { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };

    const data = await res.json();
    return {
      userAwards: normalizeUserAwards(data.userAwards),
      trackedAddresses: normalizeTrackedAddresses(data.trackedAddresses),
      badgeConfigs: normalizeBadgeConfigs(data.badgeConfigs),
      badgeDefinitions: normalizeBadgeDefinitions(data.badgeDefinitions),
    };
  } catch (e) {
    console.warn('[state] loadState failed', e.message);
    return { userAwards: {}, trackedAddresses: [], badgeConfigs: [], badgeDefinitions: [] };
  }
}

/**
 * @param {Record<string, object[]>} userAwards  plain-object map of awards
 * @param {string[]}                 trackedAddresses
 */
export async function saveState(userAwards, trackedAddresses, badgeConfigs, badgeDefinitions) {
  let intended = mergeStates({}, {
    userAwards,
    trackedAddresses,
    ...(badgeConfigs !== undefined ? { badgeConfigs } : {}),
    ...(badgeDefinitions !== undefined ? { badgeDefinitions } : {}),
  });

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt += 1) {
    const latest = await loadState();
    const merged = mergeStates(latest, intended);

    const payload = JSON.stringify({
      userAwards: merged.userAwards,
      trackedAddresses: merged.trackedAddresses,
      badgeConfigs: merged.badgeConfigs,
      badgeDefinitions: merged.badgeDefinitions,
      updatedAt: new Date().toISOString(),
    });

    await put(BLOB_PATHNAME, payload, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });

    const confirmed = await loadState();
    if (stateContains(confirmed, intended)) {
      return;
    }

    intended = mergeStates(intended, confirmed);
  }

  console.warn('[state] saveState may have partial overlap due to concurrent writes');
}
