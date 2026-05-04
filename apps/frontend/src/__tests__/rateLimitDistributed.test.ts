import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('enforceRateLimitDistributed', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.process.env.SUPABASE_URL;
    delete globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('falls back to local limiter when Supabase env is missing', async () => {
    const { enforceRateLimitDistributed, __resetRateLimitForTests } = await import('../../api/_lib/rateLimit.js');
    __resetRateLimitForTests();

    const first = await enforceRateLimitDistributed({ key: 'fallback:test', limit: 1, windowMs: 60_000 });
    const second = await enforceRateLimitDistributed({ key: 'fallback:test', limit: 1, windowMs: 60_000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });
});
