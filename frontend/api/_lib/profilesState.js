import { list, put } from '@vercel/blob';

const BLOB_PATHNAME = 'profiles-state.json';

const pickNewestBlob = (blobs = []) => {
  if (!Array.isArray(blobs) || blobs.length === 0) return null;

  return blobs
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.uploadedAt || a.pathname || 0).getTime() || 0;
      const tb = new Date(b.uploadedAt || b.pathname || 0).getTime() || 0;
      return tb - ta;
    })[0];
};

export async function loadProfilesState() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 20 });
    const newest = pickNewestBlob(blobs);
    if (!newest) return { profiles: {} };

    const res = await fetch(newest.url);
    if (!res.ok) return { profiles: {} };

    const data = await res.json();
    if (!data || typeof data !== 'object') return { profiles: {} };

    return {
      profiles: data && typeof data.profiles === 'object' ? data.profiles : {},
    };
  } catch (e) {
    console.warn('[profiles] load failed', e.message);
    return { profiles: {} };
  }
}

export async function saveProfilesState(profiles) {
  const payload = JSON.stringify({
    profiles,
    updatedAt: new Date().toISOString(),
  });

  await put(BLOB_PATHNAME, payload, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
