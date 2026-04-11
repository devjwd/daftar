import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { verifyProfileMigrationProof } from '../_lib/profileProof.js';
import {
  normalizeAddress,
  normalizeLimit,
  normalizeSearchQuery,
  sanitizeProfileInput,
} from '../_lib/profileValidation.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

const PROFILE_LIST_MAX = 100;

const createSupabaseAdmin = () => {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' };
  }

  return {
    ok: true,
    supabase: createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
  };
};

const mapProfileRow = (row) => {
  if (!row || typeof row !== 'object') return null;

  return {
    address: normalizeAddress(row.wallet_address || row.address),
    username: typeof row.username === 'string' ? row.username : '',
    bio: typeof row.bio === 'string' ? row.bio : '',
    twitter: typeof row.twitter === 'string' ? row.twitter : '',
    telegram: typeof row.telegram === 'string' ? row.telegram : '',
    pfp: typeof row.pfp === 'string'
      ? row.pfp
      : typeof row.avatar_url === 'string'
        ? row.avatar_url
        : null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    editKeyHash: row.edit_key_hash || row.editKeyHash || '',
    xp: Number(row.xp || 0),
  };
};

const buildProfileRow = (profile) => ({
  wallet_address: profile.address,
  username: profile.username,
  bio: profile.bio,
  twitter: profile.twitter,
  telegram: profile.telegram,
  avatar_url: profile.pfp,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt,
  edit_key_hash: profile.editKeyHash,
  xp: Number(profile.xp || 0),
});

const toPublicProfile = (profile) => {
  if (!profile) return null;
  const { editKey: _editKey, editKeyHash: _editKeyHash, xp: _xp, ...publicProfile } = profile;
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

const hasStoredEditKey = (profile) => Boolean(profile?.editKeyHash || profile?.editKey);

const requiresEditKeyMigration = (profile) => Boolean(profile?.address) && !hasStoredEditKey(profile);

const verifyMigrationForWrite = async ({ req, body, address }) => verifyProfileMigrationProof({
  req,
  payload: body,
  expectedAction: 'profile-migrate-save',
  expectedAddress: address,
});

const isEditKeyValid = (profile, providedEditKey) => {
  if (!profile?.address) return true;

  const provided = String(providedEditKey || '').trim();
  if (!hasStoredEditKey(profile)) return false;
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

  const supabaseResult = createSupabaseAdmin();
  if (!supabaseResult.ok) {
    return sendJson(res, 500, { error: supabaseResult.error });
  }

  const { supabase } = supabaseResult;

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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(PROFILE_LIST_MAX);

      if (error) {
        return sendJson(res, 500, { error: error.message || 'Failed to load profiles' });
      }

      const query = req.query?.query || req.query?.q || '';
      const limit = normalizeLimit(req.query?.limit, 20, 100);
      const profiles = Object.fromEntries(
        (Array.isArray(data) ? data : [])
          .map((row) => mapProfileRow(row))
          .filter(Boolean)
          .map((profile) => [profile.address, profile])
      );
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

      const currentResult = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', address)
        .maybeSingle();

      if (currentResult.error) {
        return sendJson(res, 500, { error: currentResult.error.message || 'Failed to load profile' });
      }

      const current = mapProfileRow(currentResult.data) || {};
      const providedEditKey = pickEditKey(req);
      const canUseMigrationProof = requiresEditKeyMigration(current);

      if (canUseMigrationProof) {
        const migration = await verifyMigrationForWrite({ req, body, address });
        if (!migration.ok) {
          return sendJson(res, 409, {
            error: 'Profile is missing an edit key and must be migrated with a wallet signature before it can be changed',
          });
        }
      }

      if (!canUseMigrationProof && !isEditKeyValid(current, providedEditKey)) {
        return sendJson(res, 403, { error: 'Invalid profile edit key for this address' });
      }

      const nextEditKey = providedEditKey || current.editKey || createEditKey();
      const next = {
        address,
        ...sanitizeProfileInput(body, current),
        xp: current.xp || 0,
        editKeyHash: hashEditKey(nextEditKey),
      };

      const upsertResult = await supabase
        .from('profiles')
        .upsert(buildProfileRow(next), { onConflict: 'wallet_address' });

      if (upsertResult.error) {
        return sendJson(res, 500, { error: upsertResult.error.message || 'failed to save profile' });
      }

      return sendJson(res, 200, { ...toPublicProfile(next), editKey: nextEditKey });
    } catch (e) {
      const status = /must be|required|valid/i.test(String(e?.message || '')) ? 400 : 500;
      return sendJson(res, status, { error: e.message || 'failed to save profile' });
    }
  }

  return methodNotAllowed(res, req.method, METHODS);
}
