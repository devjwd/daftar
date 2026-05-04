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

