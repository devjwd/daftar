import { loadProfilesState, saveProfilesState } from '../_lib/profilesState.js';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import {
  normalizeAddress,
  normalizeLimit,
  normalizeSearchQuery,
  sanitizeProfileInput,
} from '../_lib/profileValidation.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

const toPublicProfile = (profile) => {
  if (!profile) return null;
  const { editKey: _editKey, editKeyHash: _editKeyHash, ...publicProfile } = profile;
  return publicProfile;
};

const pickEditKey = (req) => {
  const header = req.headers?.['x-profile-edit-key'];
  const body = req.body?.editKey;
  const value = header || body;
  return value ? String(value).trim() : '';
};

const createEditKey = () => randomBytes(24).toString('hex');

const hashEditKey = (editKey) => createHash('sha256').update(String(editKey)).digest('hex');

const safeHashEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');

  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

const isEditKeyValid = (profile, providedEditKey) => {
  const provided = String(providedEditKey || '').trim();
  const hasStoredKey = Boolean(profile?.editKeyHash || profile?.editKey);
  if (!hasStoredKey) return true;
  if (!provided) return false;

  if (profile.editKeyHash) {
    return safeHashEqual(hashEditKey(provided), profile.editKeyHash);
  }

  return provided === profile.editKey;
};

const searchProfiles = (profiles, query, limit = 20) => {
  const lowerQuery = normalizeSearchQuery(query);
  if (!lowerQuery) {
    return Object.values(profiles)
      .map((profile) => toPublicProfile(profile))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit);
  }

  return Object.values(profiles)
    .map((profile) => toPublicProfile(profile))
    .filter((profile) => {
      return (
        profile.username?.toLowerCase().includes(lowerQuery) ||
        profile.address?.toLowerCase().includes(lowerQuery) ||
        profile.bio?.toLowerCase().includes(lowerQuery) ||
        profile.twitter?.toLowerCase().includes(lowerQuery) ||
        profile.telegram?.toLowerCase().includes(lowerQuery)
      );
    })
    .slice(0, limit);
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  const ip = getClientIp(req);
  const writeLimiter = enforceRateLimit({
    key: `profiles:index:write:${ip}`,
    limit: Number(process.env.PROFILE_WRITE_RATE_LIMIT || 20),
    windowMs: Number(process.env.PROFILE_WRITE_RATE_WINDOW_MS || 60_000),
  });
  const readLimiter = enforceRateLimit({
    key: `profiles:index:read:${ip}`,
    limit: Number(process.env.PROFILE_READ_RATE_LIMIT || 120),
    windowMs: Number(process.env.PROFILE_READ_RATE_WINDOW_MS || 60_000),
  });

  if (req.method === 'GET') {
    if (!readLimiter.ok) {
      res.setHeader('Retry-After', String(readLimiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    try {
      const { profiles } = await loadProfilesState();
      const query = req.query?.query || req.query?.q || '';
      const limit = normalizeLimit(req.query?.limit, 20, 100);
      return sendJson(res, 200, searchProfiles(profiles, query, limit));
    } catch (error) {
      return sendJson(res, 500, { error: 'Failed to load profiles' });
    }
  }

  if (req.method === 'POST') {
    if (!writeLimiter.ok) {
      res.setHeader('Retry-After', String(writeLimiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    try {
      const body = req.body || {};
      const address = normalizeAddress(body.address);
      if (!address) {
        return sendJson(res, 400, { error: 'valid address is required' });
      }

      const { profiles } = await loadProfilesState();
      const current = profiles[address] || {};
      const providedEditKey = pickEditKey(req);

      if (!isEditKeyValid(current, providedEditKey)) {
        return sendJson(res, 403, { error: 'Invalid profile edit key for this address' });
      }

      const nextEditKey = providedEditKey || current.editKey || createEditKey();
      const next = {
        address,
        ...sanitizeProfileInput(body, current),
        editKeyHash: hashEditKey(nextEditKey),
      };

      profiles[address] = next;
      await saveProfilesState(profiles);
      return sendJson(res, 200, { ...toPublicProfile(next), editKey: nextEditKey });
    } catch (e) {
      const status = /must be|required|valid/i.test(String(e?.message || '')) ? 400 : 500;
      return sendJson(res, status, { error: e.message || 'failed to save profile' });
    }
  }

  return methodNotAllowed(res, req.method, METHODS);
}
