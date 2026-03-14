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

/**
 * Returns { userAwards: { [address]: [{badgeId,payload,awardedAt},...] },
 *           trackedAddresses: string[] }
 */
export async function loadState() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    if (blobs.length === 0) return { userAwards: {}, trackedAddresses: [] };

    const res = await fetch(blobs[0].url);
    if (!res.ok) return { userAwards: {}, trackedAddresses: [] };

    const data = await res.json();
    return {
      userAwards:
        data.userAwards && typeof data.userAwards === 'object' ? data.userAwards : {},
      trackedAddresses: Array.isArray(data.trackedAddresses) ? data.trackedAddresses : [],
    };
  } catch (e) {
    console.warn('[state] loadState failed', e.message);
    return { userAwards: {}, trackedAddresses: [] };
  }
}

/**
 * @param {Record<string, object[]>} userAwards  plain-object map of awards
 * @param {string[]}                 trackedAddresses
 */
export async function saveState(userAwards, trackedAddresses) {
  const payload = JSON.stringify({
    userAwards,
    trackedAddresses,
    updatedAt: new Date().toISOString(),
  });

  await put(BLOB_PATHNAME, payload, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
