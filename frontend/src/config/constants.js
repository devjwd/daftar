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
  PRICE_UPDATE: 60000,      // 1 minute
  NETWORK_CHECK: 30000,      // 30 seconds
};

// API Configuration
export const API_CONFIG = {
  PRICE_FETCH_TIMEOUT: 10000,  // 10 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000,           // 5 seconds (base delay)
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

