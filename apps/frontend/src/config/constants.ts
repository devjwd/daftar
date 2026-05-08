// Application-wide constants

// Token Decimals
export const DECIMALS = {
  DEFAULT: 8,
  USDT: 6,
  USDC: 6,
  MOVE: 8,
};

// Update Intervals (in milliseconds)
export const INTERVALS = {
  PRICE_UPDATE: 300000,      // 5 minutes (300,000ms) - Optimized for free tier API limits
  NETWORK_CHECK: 30000,      // 30 seconds
};

// API Configuration
export const API_CONFIG = {
  PRICE_FETCH_TIMEOUT: 5000,   // 5 seconds
  MAX_RETRIES: 2,
  RETRY_DELAY: 2000,           // 2 seconds (base delay)
};

// Display Formatting
export const FORMATTING = {
  ADDRESS_START_CHARS: 6,
  ADDRESS_END_CHARS: 4,
  TOKEN_DISPLAY_DECIMALS: 2,
  TOKEN_MAX_DECIMALS: 4,
  USD_DISPLAY_DECIMALS: 2,
};

// Animation Delays (in milliseconds)
export const ANIMATION_DELAYS = {
  TOKEN_CARD: 50,
  STAKING_CARD: 100,
};

