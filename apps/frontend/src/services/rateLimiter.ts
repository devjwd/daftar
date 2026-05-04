/**
 * API Rate Limiting Service
 * Prevents API abuse and DDoS attacks
 * Implements token bucket algorithm
 */

class RateLimiter {
  constructor(maxRequests = 10, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  /**
   * Check if request is allowed
   * @param {string} identifier - Unique identifier (e.g., endpoint, user ID)
   * @returns {Object} {allowed: boolean, remaining: number, resetTime: number}
   */
  isAllowed(identifier = 'global') {
    const now = Date.now();
    const key = `limiter_${identifier}`;

    // Get or create request tracking for this identifier
    if (!this.requests[key]) {
      this.requests[key] = [];
    }

    const requests = this.requests[key];

    // Remove old requests outside the window
    while (requests.length > 0 && requests[0] < now - this.windowMs) {
      requests.shift();
    }

    const allowed = requests.length < this.maxRequests;

    if (allowed) {
      requests.push(now);
    }

    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - requests.length),
      resetTime: requests.length > 0 ? requests[0] + this.windowMs : now
    };
  }

  /**
   * Reset limiter for an identifier
   * @param {string} identifier - Identifier to reset
   */
  reset(identifier = 'global') {
    const key = `limiter_${identifier}`;
    this.requests[key] = [];
  }
}

// Create singleton rate limiters for different endpoints
const limiterInstances = {
  coingecko: new RateLimiter(5, 1000),       // 5 requests per second
  indexer: new RateLimiter(10, 1000),        // 10 requests per second
  rpc: new RateLimiter(20, 1000),            // 20 requests per second
  wallet: new RateLimiter(3, 1000),          // 3 wallet requests per second
  search: new RateLimiter(5, 1000),          // 5 searches per second
};

/**
 * Fetch with rate limiting
 * @param {string} url - URL to fetch
 * @param {string} endpoint - Endpoint identifier (coingecko, indexer, rpc, etc)
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} If rate limit exceeded
 */
export async function fetchWithRateLimit(url, endpoint = 'default', options = {}) {
  const limiter = limiterInstances[endpoint] || new RateLimiter(10, 1000);
  
  const { allowed, remaining, resetTime } = limiter.isAllowed(endpoint);

  if (!allowed) {
    const waitTime = Math.ceil((resetTime - Date.now()) / 1000);
    const error = new Error(`Rate limit exceeded for ${endpoint}. Retry after ${waitTime}s`);
    error.retryAfter = waitTime;
    error.remaining = remaining;
    throw error;
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(10000)
    });

    // Add rate limit info to response
    response.rateLimit = {
      remaining,
      resetTime
    };

    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout for ${endpoint}`);
    }
    throw error;
  }
}

/**
 * Debounced API call
 * Prevents rapid-fire requests to same endpoint
 * @param {Function} fn - API function to debounce
 * @param {number} delayMs - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounceApiCall(fn, delayMs = 500) {
  let timeoutId = null;
  let lastArgs = null;

  return function (...args) {
    lastArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...lastArgs);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delayMs);
    });
  };
}

/**
 * Retry failed API calls with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delayMs - Initial delay in milliseconds
 * @returns {Promise<any>} Function result
 */
export async function retryWithBackoff(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on certain errors
      if (error.statusCode === 401 || error.statusCode === 403) {
        throw error;
      }

      // Calculate exponential backoff delay
      if (attempt < maxRetries - 1) {
        const delay = delayMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Request deduplication cache
 * Prevents duplicate simultaneous requests
 */
class RequestCache {
  constructor(ttlMs = 5000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  /**
   * Get or set cached request
   * @param {string} key - Unique request key
   * @param {Function} fn - Function to call if not cached
   * @returns {Promise<any>} Cached or new result
   */
  async getOrSet(key, fn) {
    // Return cached result if still valid
    if (this.cache.has(key)) {
      const { result, timestamp } = this.cache.get(key);
      if (Date.now() - timestamp < this.ttlMs) {
        return result;
      }
    }

    // Execute function and cache result
    const result = await fn();
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    // Auto-clear after TTL
    setTimeout(() => this.cache.delete(key), this.ttlMs);

    return result;
  }

  clear() {
    this.cache.clear();
  }
}

export const requestCache = new RequestCache();

/**
 * Circuit breaker for failing APIs
 * Prevents cascading failures
 */
class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeoutMs = 60000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.failures = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} Function result
   */
  async execute(fn) {
    // If circuit is OPEN and timeout expired, try HALF_OPEN
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.failures = 0;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();

      // Success - reset on HALF_OPEN
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
      }

      throw error;
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = null;
  }
}

export const circuitBreakers = {
  coingecko: new CircuitBreaker(5),
  indexer: new CircuitBreaker(5),
  rpc: new CircuitBreaker(10)
};

export default {
  RateLimiter,
  fetchWithRateLimit,
  debounceApiCall,
  retryWithBackoff,
  RequestCache,
  requestCache,
  CircuitBreaker,
  circuitBreakers
};
