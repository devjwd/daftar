/**
 * Environment Variables Schema & Validation
 * Ensures all required env vars are set with correct types
 */

/**
 * Environment variable schema definition
 * Defines structure, type, and validation rules
 */
const ENV_SCHEMA = {
  VITE_NETWORK: {
    type: 'string',
    required: true,
    default: 'mainnet',
    validate: (val) => ['mainnet', 'testnet'].includes(val),
    error: 'VITE_NETWORK must be "mainnet" or "testnet"'
  },
  
  VITE_SWAP_ROUTER_ADDRESS: {
    type: 'string',
    required: false,
    validate: (val) => !val || /^0x[a-f0-9]{1,64}$/i.test(val),
    error: 'VITE_SWAP_ROUTER_ADDRESS must be valid hex address or empty'
  },
  
  VITE_BADGE_MODULE_ADDRESS: {
    type: 'string',
    required: false,
    validate: (val) => !val || /^0x[a-f0-9]{1,64}$/i.test(val),
    error: 'VITE_BADGE_MODULE_ADDRESS must be valid hex address or empty'
  },
  
  VITE_SENTRY_DSN: {
    type: 'string',
    required: false,
    validate: (val) => !val || val.startsWith('https://'),
    error: 'VITE_SENTRY_DSN must be valid HTTPS URL or empty'
  },
  
  VITE_SENTRY_ENVIRONMENT: {
    type: 'string',
    required: false,
    default: 'production',
    validate: (val) => !val || ['development', 'staging', 'production'].includes(val),
    error: 'VITE_SENTRY_ENVIRONMENT must be valid environment'
  },
  
  VITE_SENTRY_TRACES_SAMPLE_RATE: {
    type: 'number',
    required: false,
    default: 0.1,
    validate: (val) => val === '' || (Number(val) >= 0 && Number(val) <= 1),
    error: 'VITE_SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1'
  },
  
  VITE_GOOGLE_ANALYTICS_ID: {
    type: 'string',
    required: false,
    validate: (val) => !val || /^G-[A-Z0-9]+$/.test(val),
    error: 'VITE_GOOGLE_ANALYTICS_ID must be valid Google Analytics ID'
  },
  
  VITE_MOSAIC_API_URL: {
    type: 'string',
    required: false,
    default: 'https://api.mosaic.cloud',
    validate: (val) => !val || val.startsWith('https://'),
    error: 'VITE_MOSAIC_API_URL must be valid HTTPS URL'
  },
  
  VITE_COINGECKO_API_KEY: {
    type: 'string',
    required: false,
    validate: (val) => !val || (typeof val === 'string' && val.length > 0),
    error: 'VITE_COINGECKO_API_KEY must be non-empty string or empty'
  },
  
  VITE_ENABLE_SWAP: {
    type: 'boolean',
    required: false,
    default: 'true',
    validate: (val) => val === '' || ['true', 'false'].includes(String(val).toLowerCase()),
    error: 'VITE_ENABLE_SWAP must be "true" or "false"'
  },
  
  VITE_ENABLE_BADGES: {
    type: 'boolean',
    required: false,
    default: 'true',
    validate: (val) => val === '' || ['true', 'false'].includes(String(val).toLowerCase()),
    error: 'VITE_ENABLE_BADGES must be "true" or "false"'
  },
  
  VITE_DEBUG_MODE: {
    type: 'boolean',
    required: false,
    default: 'false',
    validate: (val) => val === '' || ['true', 'false'].includes(String(val).toLowerCase()),
    error: 'VITE_DEBUG_MODE must be "true" or "false"'
  },
  
  VITE_API_TIMEOUT: {
    type: 'number',
    required: false,
    default: 10000,
    validate: (val) => val === '' || (Number(val) > 0 && Number(val) < 60000),
    error: 'VITE_API_TIMEOUT must be between 1 and 60000 (milliseconds)'
  }
};

/**
 * Convert string env values to correct type
 * @param {string} value - Environment variable value
 * @param {string} type - Expected type (string, number, boolean)
 * @returns {any} Converted value
 */
function convertEnvValue(value, type) {
  if (value === '') {
    return undefined;
  }

  switch (type) {
    case 'number':
      const num = Number(value);
      return isNaN(num) ? undefined : num;
    
    case 'boolean':
      return String(value).toLowerCase() === 'true';
    
    case 'string':
    default:
      return value;
  }
}

/**
 * Validate environment variables
 * @throws {Error} If validation fails
 * @returns {Object} Validated environment variables
 */
export function validateEnvironment() {
  const errors = [];
  const validated = {};

  // Check each schema key
  for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
    const value = import.meta.env[key];
    const hasValue = value !== undefined && value !== '';

    // Check required
    if (schema.required && !hasValue) {
      errors.push(`Missing required environment variable: ${key}`);
      continue;
    }

    // Use default if not provided
    let finalValue = hasValue ? value : schema.default;

    // Convert to correct type
    if (finalValue !== undefined) {
      finalValue = convertEnvValue(finalValue, schema.type);
    }

    // Validate
    if (finalValue !== undefined && schema.validate && !schema.validate(finalValue)) {
      errors.push(schema.error || `Invalid value for ${key}: ${value}`);
      continue;
    }

    validated[key] = finalValue;
  }

  // Throw error if validation failed
  if (errors.length > 0) {
    const errorMessage = 'Environment validation failed:\n' + errors.join('\n');
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  return validated;
}

/**
 * Check if we're in development environment
 * @returns {boolean}
 */
export function isDevelopment() {
  return import.meta.env.DEV;
}

/**
 * Check if we're in production environment
 * @returns {boolean}
 */
export function isProduction() {
  return import.meta.env.PROD;
}

/**
 * Get environment variable with type safety
 * @param {string} key - Environment key
 * @param {any} defaultValue - Default if not present
 * @returns {any} Environment value or default
 */
export function getEnv(key, defaultValue = undefined) {
  const schema = ENV_SCHEMA[key];
  if (!schema) {
    console.warn(`Unknown environment variable: ${key}`);
    return defaultValue;
  }

  const value = import.meta.env[key] || schema.default;
  return convertEnvValue(value, schema.type) ?? defaultValue;
}

/**
 * Export environment summary (safe, no secrets)
 * @returns {Object} Safe environment config
 */
export function getEnvironmentSummary() {
  return {
    network: getEnv('VITE_NETWORK'),
    isDev: isDevelopment(),
    isProd: isProduction(),
    hasSwap: getEnv('VITE_ENABLE_SWAP', false),
    hasBadges: getEnv('VITE_ENABLE_BADGES', false),
    debugMode: getEnv('VITE_DEBUG_MODE', false),
    sentryEnabled: !!getEnv('VITE_SENTRY_DSN')
  };
}

/**
 * Log environment validation result
 */
export function logEnvironmentInfo() {
  const summary = getEnvironmentSummary();
  console.table(summary);
}

export default {
  ENV_SCHEMA,
  validateEnvironment,
  isDevelopment,
  isProduction,
  getEnv,
  getEnvironmentSummary,
  logEnvironmentInfo
};
