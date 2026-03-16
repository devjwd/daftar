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

const normalizeTrackedAddresses = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)));
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
    const normalizedAddr = String(addr || '').trim().toLowerCase();
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

const mergeStates = (left, right) => {
  const leftAwards = normalizeUserAwards(left?.userAwards);
  const rightAwards = normalizeUserAwards(right?.userAwards);

  const mergedAwards = { ...leftAwards };
  for (const [addr, awards] of Object.entries(rightAwards)) {
    mergedAwards[addr] = normalizeAwardsList([...(leftAwards[addr] || []), ...awards]);
  }

  const hasRightBadgeConfigs =
    right && Object.prototype.hasOwnProperty.call(right, 'badgeConfigs');

  return {
    userAwards: mergedAwards,
    trackedAddresses: normalizeTrackedAddresses([
      ...(left?.trackedAddresses || []),
      ...(right?.trackedAddresses || []),
    ]),
    badgeConfigs: hasRightBadgeConfigs
      ? normalizeBadgeConfigs(right?.badgeConfigs)
      : normalizeBadgeConfigs(left?.badgeConfigs),
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

  return true;
};

/**
 * Returns { userAwards: { [address]: [{badgeId,payload,awardedAt},...] },
 *           trackedAddresses: string[] }
 */
export async function loadState() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    if (blobs.length === 0) return { userAwards: {}, trackedAddresses: [], badgeConfigs: [] };

    const res = await fetch(blobs[0].url);
    if (!res.ok) return { userAwards: {}, trackedAddresses: [], badgeConfigs: [] };

    const data = await res.json();
    return {
      userAwards: normalizeUserAwards(data.userAwards),
      trackedAddresses: normalizeTrackedAddresses(data.trackedAddresses),
      badgeConfigs: normalizeBadgeConfigs(data.badgeConfigs),
    };
  } catch (e) {
    console.warn('[state] loadState failed', e.message);
    return { userAwards: {}, trackedAddresses: [], badgeConfigs: [] };
  }
}

/**
 * @param {Record<string, object[]>} userAwards  plain-object map of awards
 * @param {string[]}                 trackedAddresses
 */
export async function saveState(userAwards, trackedAddresses, badgeConfigs) {
  let intended = mergeStates({}, {
    userAwards,
    trackedAddresses,
    ...(badgeConfigs !== undefined ? { badgeConfigs } : {}),
  });

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt += 1) {
    const latest = await loadState();
    const merged = mergeStates(latest, intended);

    const payload = JSON.stringify({
      userAwards: merged.userAwards,
      trackedAddresses: merged.trackedAddresses,
      badgeConfigs: merged.badgeConfigs,
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
