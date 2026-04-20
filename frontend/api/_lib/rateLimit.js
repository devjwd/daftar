import { createClient } from '@supabase/supabase-js';

const buckets = new Map();
let cachedSupabaseAdmin = null;

const now = () => Date.now();

const isFinitePositive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const cleanupBucket = (bucket, cutoff) => {
  while (bucket.length > 0 && bucket[0] <= cutoff) {
    bucket.shift();
  }
};

export const enforceRateLimit = ({
  key,
  limit = 60,
  windowMs = 60_000,
}) => {
  const effectiveLimit = isFinitePositive(limit, 60);
  const effectiveWindowMs = isFinitePositive(windowMs, 60_000);

  const ts = now();
  const cutoff = ts - effectiveWindowMs;

  const bucket = buckets.get(key) || [];
  cleanupBucket(bucket, cutoff);

  if (bucket.length >= effectiveLimit) {
    const oldest = bucket[0] || ts;
    const retryAfterMs = Math.max(0, effectiveWindowMs - (ts - oldest));

    return {
      ok: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      remaining: 0,
      limit: effectiveLimit,
    };
  }

  bucket.push(ts);
  buckets.set(key, bucket);

  const remaining = Math.max(0, effectiveLimit - bucket.length);

  return {
    ok: true,
    remaining,
    limit: effectiveLimit,
    retryAfterSeconds: 0,
  };
};

const getSupabaseAdmin = () => {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseServiceKey) return null;

  cachedSupabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabaseAdmin;
};

export const enforceRateLimitDistributed = async ({
  key,
  limit = 60,
  windowMs = 60_000,
}) => {
  const effectiveLimit = isFinitePositive(limit, 60);
  const effectiveWindowMs = isFinitePositive(windowMs, 60_000);

  const ts = now();
  const resetAtMs = Math.ceil(ts / effectiveWindowMs) * effectiveWindowMs;
  const windowStartMs = resetAtMs - effectiveWindowMs;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return enforceRateLimit({ key, limit: effectiveLimit, windowMs: effectiveWindowMs });
  }

  try {
    const { data, error } = await supabase.rpc('increment_api_rate_limit', {
      p_key: key,
      p_window_start: new Date(windowStartMs).toISOString(),
      p_window_ms: effectiveWindowMs,
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      return enforceRateLimit({ key, limit: effectiveLimit, windowMs: effectiveWindowMs });
    }

    const row = data[0] || {};
    const count = Number(row.count || 0);
    const resetAt = new Date(String(row.reset_at || new Date(resetAtMs).toISOString())).getTime();
    const retryAfterSeconds = Math.max(0, Math.ceil((resetAt - ts) / 1000));

    if (count > effectiveLimit) {
      return {
        ok: false,
        retryAfterSeconds,
        remaining: 0,
        limit: effectiveLimit,
      };
    }

    return {
      ok: true,
      remaining: Math.max(0, effectiveLimit - count),
      limit: effectiveLimit,
      retryAfterSeconds,
    };
  } catch {
    return enforceRateLimit({ key, limit: effectiveLimit, windowMs: effectiveWindowMs });
  }
};

export const __resetRateLimitForTests = () => {
  buckets.clear();
  cachedSupabaseAdmin = null;
};
