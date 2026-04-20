import { beforeEach, describe, expect, it } from 'vitest';
import syncHandler from '../../api/badges/sync.js';
import claimHandler from '../../api/badges/claim.js';
import { __resetRateLimitForTests } from '../../api/_lib/rateLimit.js';

const createReq = ({ method = 'POST', body = {}, headers = {}, ip = '127.0.0.1' } = {}) => ({
  method,
  body,
  headers,
  query: {},
  socket: { remoteAddress: ip },
  connection: { remoteAddress: ip },
});

const createRes = () => {
  const response = {
    statusCode: 200,
    headers: {},
    payload: undefined,
    ended: false,
  };

  return {
    setHeader(name, value) {
      response.headers[name] = value;
      return this;
    },
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(payload) {
      response.payload = payload;
      return this;
    },
    end() {
      response.ended = true;
      return this;
    },
    get data() {
      return response;
    },
  };
};

describe('API mutation route rate limits', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    delete globalThis.process.env.SUPABASE_URL;
    delete globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY;

    globalThis.process.env.BADGES_WRITE_RATE_LIMIT = '1';
    globalThis.process.env.BADGES_WRITE_RATE_WINDOW_MS = '60000';
    globalThis.process.env.BADGE_ADMIN_SECRET = 'super-secret';
  });

  it('throttles repeated POSTs for /api/badges/sync', async () => {
    const firstReq = createReq({ method: 'POST', body: {}, ip: '10.0.0.10' });
    const firstRes = createRes();
    await syncHandler(firstReq, firstRes);

    expect(firstRes.data.statusCode).toBe(400);

    const secondReq = createReq({ method: 'POST', body: {}, ip: '10.0.0.10' });
    const secondRes = createRes();
    await syncHandler(secondReq, secondRes);

    expect(secondRes.data.statusCode).toBe(429);
    expect(secondRes.data.payload).toEqual({ error: 'Too many requests' });
  });

  it('throttles repeated POSTs for /api/badges/claim before auth executes', async () => {
    const firstReq = createReq({ method: 'POST', body: {}, ip: '10.0.0.20' });
    const firstRes = createRes();
    await claimHandler(firstReq, firstRes);

    expect(firstRes.data.statusCode).toBe(401);

    const secondReq = createReq({ method: 'POST', body: {}, ip: '10.0.0.20' });
    const secondRes = createRes();
    await claimHandler(secondReq, secondRes);

    expect(secondRes.data.statusCode).toBe(429);
    expect(secondRes.data.payload).toEqual({ error: 'Too many requests' });
  });
});
