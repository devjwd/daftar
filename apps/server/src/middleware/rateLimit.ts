import rateLimit from 'express-rate-limit';

const oneMinuteMs = 60 * 1000;

export const badgeLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export const awardLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export const profileLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for profile lookups' },
});

export const generalLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict limiter for forced re-evaluations (force=true)
 * Prevents users from hammering RPC providers.
 */
export const forceRefreshLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 2, // Max 2 forced refreshes per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer wallet address as the key for better fairness
    return (req.query.wallet as string) || (req.query.address as string) || req.ip || 'unknown';
  },
  skip: (req) => req.query.force !== 'true',
  message: { error: 'Rate limit exceeded for forced refreshes. Please wait 30 seconds.' },
});

