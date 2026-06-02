interface CacheEntry {
  data: any;
  timestamp: number;
}

class AnalyticsInMemCache {
  private cache = new Map<string, CacheEntry>();
  private TTL = 30 * 60 * 1000; // 30 minutes default TTL

  private getCacheKey(wallet: string, timeframe: string): string {
    return `${wallet.toLowerCase().trim()}:${timeframe.toLowerCase().trim()}`;
  }

  public get(wallet: string, timeframe: string): any | null {
    const key = this.getCacheKey(wallet, timeframe);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  public set(wallet: string, timeframe: string, data: any): void {
    const key = this.getCacheKey(wallet, timeframe);
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  public invalidate(wallet: string): void {
    const prefix = `${wallet.toLowerCase().trim()}:`;
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[AnalyticsCache] 🧹 Invalidated ${count} cache entries for wallet: ${wallet}`);
    }
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const analyticsCache = new AnalyticsInMemCache();
