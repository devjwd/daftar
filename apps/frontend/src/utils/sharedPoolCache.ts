/**
 * Shared Pool Metadata Cache
 * Prevents redundant RPC calls for static or slow-moving pool data 
 * (e.g., Total Supply, Pool Decimals, underlying Token Pairs)
 */

type CacheEntry = {
  data: any;
  timestamp: number;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 60 * 1000; // 1 minute default TTL

export const sharedPoolCache = {
  /**
   * Get an item from cache if it exists and is fresh
   */
  get: (key: string, ttl: number = DEFAULT_TTL) => {
    const entry = cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > ttl) {
      cache.delete(key);
      return null;
    }
    
    return entry.data;
  },

  /**
   * Store an item in the cache
   */
  set: (key: string, data: any) => {
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
  },

  /**
   * Helper to wrap an async fetcher with caching
   */
  fetch: async (key: string, fetcher: () => Promise<any>, ttl: number = DEFAULT_TTL) => {
    const cached = sharedPoolCache.get(key, ttl);
    if (cached) return cached;
    
    try {
      const fresh = await fetcher();
      if (fresh) {
        sharedPoolCache.set(key, fresh);
      }
      return fresh;
    } catch (err) {
      console.warn(`Cache fetch failed for ${key}:`, err);
      return null;
    }
  },

  clear: () => cache.clear()
};
