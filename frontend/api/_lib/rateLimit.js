const buckets = new Map();

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
