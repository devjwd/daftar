import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSystemConfig } from '../api';

const MOCK_API_URL = 'http://localhost:3000';
vi.stubEnv('VITE_API_URL', MOCK_API_URL);

// Mock the global fetch
const globalFetch = global.fetch;

describe('api.ts callApi and Resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = globalFetch;
  });

  it('should successfully fetch data when server responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ some: 'data' })
    });

    const response = await getSystemConfig();
    expect(response).toEqual({ some: 'data' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 500 server errors and eventually fail after retries', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' })
    });

    const promise = getSystemConfig();
    
    // Fast-forward timers for retries
    // attempt 1 fails immediately, wait 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    // attempt 2 fails, wait 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    // attempt 3 fails, wait 4000ms
    await vi.advanceTimersByTimeAsync(4000);
    // attempt 4 (max retries exceeded) -> returns error
    
    const response = await promise;
    expect(response).toEqual({}); // getSystemConfig returns {} on failure
    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('should retry on network errors and succeed on a subsequent try', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new TypeError('Failed to fetch'); // Simulate network error
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    });

    const promise = getSystemConfig();
    
    // Fast-forward
    await vi.advanceTimersByTimeAsync(1000); // Wait for first retry delay
    await vi.advanceTimersByTimeAsync(2000); // Wait for second retry delay

    const response = await promise;
    expect(response).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
