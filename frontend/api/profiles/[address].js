import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'crypto';
import { enforceRateLimit, enforceRateLimitDistributed } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { normalizeAddress } from '../_lib/profileValidation.js';
import { verifyProfileMigrationProof } from '../_lib/profileProof.js';

const METHODS = ['GET', 'DELETE', 'OPTIONS'];

const createSupabaseAdmin = () => {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
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
    xp: Number(row.xp || 0), // Include XP in the profile response
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    editKeyHash: row.edit_key_hash || row.editKeyHash || '',
  };
};

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

const hasStoredEditKey = (profile) => Boolean(profile?.editKeyHash || profile?.editKey);

const requiresEditKeyMigration = (profile) => Boolean(profile?.address) && !hasStoredEditKey(profile);

const verifyMigrationForDelete = async ({ req, address }) => verifyProfileMigrationProof({
  req,
  payload: {},
  expectedAction: 'profile-migrate-delete',
  expectedAddress: address,
});

const isEditKeyValid = (profile, providedEditKey) => {
  if (!profile?.address) return false;

  const provided = String(providedEditKey || '').trim();
  if (!hasStoredEditKey(profile)) return false;
  if (!provided) return false;

  if (profile.editKeyHash) {
    return safeHashEqual(hashEditKey(provided), profile.editKeyHash);
  }

  return provided === profile.editKey;
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
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', address)
        .maybeSingle();

      if (result.error) {
        return sendJson(res, 500, { error: result.error.message || 'Failed to load profile' });
      }

      return sendJson(res, 200, toPublicProfile(mapProfileRow(result.data)));
    } catch {
      return sendJson(res, 500, { error: 'Failed to load profile' });
    }
  }

  if (req.method === 'DELETE') {
    const writeLimiter = await enforceRateLimitDistributed({
      key: `profiles:address:write:${ip}`,
      limit: Number(process.env.PROFILE_WRITE_RATE_LIMIT || 20),
      windowMs: Number(process.env.PROFILE_WRITE_RATE_WINDOW_MS || 60_000),
    });

    if (!writeLimiter.ok) {
      res.setHeader('Retry-After', String(writeLimiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    try {
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', address)
        .maybeSingle();

      if (result.error) {
        return sendJson(res, 500, { error: result.error.message || 'Failed to load profile' });
      }

      const target = mapProfileRow(result.data);
      if (!target) {
        return sendJson(res, 200, { deleted: false });
      }

      const canUseMigrationProof = requiresEditKeyMigration(target);
      if (canUseMigrationProof) {
        const migration = await verifyMigrationForDelete({ req, address });
        if (!migration.ok) {
          return sendJson(res, 409, {
            error: 'Profile is missing an edit key and must be migrated with a wallet signature before it can be deleted',
          });
        }
      }

      const providedEditKey = pickEditKey(req);
      if (!canUseMigrationProof && !isEditKeyValid(target, providedEditKey)) {
        return sendJson(res, 403, { error: 'Invalid profile edit key for this address' });
      }

      const deleteResult = await supabase
        .from('profiles')
        .delete()
        .eq('wallet_address', address);

      if (deleteResult.error) {
        return sendJson(res, 500, { error: deleteResult.error.message || 'Failed to delete profile' });
      }

      return sendJson(res, 200, { deleted: true });
    } catch {
      return sendJson(res, 500, { error: 'Failed to delete profile' });
    }
  }

  return methodNotAllowed(res, req.method, METHODS);
}
