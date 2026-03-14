import { loadProfilesState, saveProfilesState } from '../_lib/profilesState.js';
import { createHash, timingSafeEqual } from 'crypto';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { normalizeAddress } from '../_lib/profileValidation.js';

const METHODS = ['GET', 'DELETE', 'OPTIONS'];

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

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  const ip = getClientIp(req);
  const writeLimiter = enforceRateLimit({
    key: `profiles:address:write:${ip}`,
    limit: Number(process.env.PROFILE_WRITE_RATE_LIMIT || 20),
    windowMs: Number(process.env.PROFILE_WRITE_RATE_WINDOW_MS || 60_000),
  });
  const readLimiter = enforceRateLimit({
    key: `profiles:address:read:${ip}`,
    limit: Number(process.env.PROFILE_READ_RATE_LIMIT || 120),
    windowMs: Number(process.env.PROFILE_READ_RATE_WINDOW_MS || 60_000),
  });

  const address = normalizeAddress(req.query?.address);
  if (!address) {
    return sendJson(res, 400, { error: 'valid address is required' });
  }

  if (req.method === 'GET') {
    if (!readLimiter.ok) {
      res.setHeader('Retry-After', String(readLimiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    try {
      const { profiles } = await loadProfilesState();
      return sendJson(res, 200, toPublicProfile(profiles[address] || null));
    } catch {
      return sendJson(res, 500, { error: 'Failed to load profile' });
    }
  }

  if (req.method === 'DELETE') {
    if (!writeLimiter.ok) {
      res.setHeader('Retry-After', String(writeLimiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    try {
      const { profiles } = await loadProfilesState();
      const target = profiles[address];
      if (!target) {
        return sendJson(res, 200, { deleted: false });
      }

      const providedEditKey = pickEditKey(req);
      if (!isEditKeyValid(target, providedEditKey)) {
        return sendJson(res, 403, { error: 'Invalid profile edit key for this address' });
      }

      const existed = Boolean(profiles[address]);
      if (existed) {
        delete profiles[address];
        await saveProfilesState(profiles);
      }
      return sendJson(res, 200, { deleted: existed });
    } catch {
      return sendJson(res, 500, { error: 'Failed to delete profile' });
    }
  }

  return methodNotAllowed(res, req.method, METHODS);
}
