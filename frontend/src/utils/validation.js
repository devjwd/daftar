/**
 * Input Validation & Sanitization Utilities
 * Prevents XSS, injection attacks, and invalid data processing
 */

/**
 * Validate if string is a valid Movement Network address
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid address format
 */
export function isValidAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const normalized = String(address).trim().toLowerCase();
  
  // Valid Movement addresses: 0x followed by 1-64 hex characters
  const addressRegex = /^0x[a-f0-9]{1,64}$/i;
  return addressRegex.test(normalized);
}

/**
 * Sanitize address for safe storage/display
 * Removes potential injection vectors
 * @param {string} address - Address to sanitize
 * @returns {string} Sanitized address or empty string if invalid
 */
export function sanitizeAddress(address) {
  if (!isValidAddress(address)) {
    return '';
  }
  
  return String(address).trim().toLowerCase();
}

/**
 * Validate and sanitize coin type string
 * Prevents invalid coin type parsing
 * @param {string} coinType - Coin type to validate (e.g., "0x1::coin::CoinStore<0x...>")
 * @returns {boolean} True if valid coin type format
 */
export function isValidCoinType(coinType) {
  if (!coinType || typeof coinType !== 'string') {
    return false;
  }

  if (coinType.length > 1000) { // Unreasonable length
    return false;
  }

  // Basic structure check: should contain :: and angle brackets for generics
  const hasValidStructure = 
    /^0x[a-f0-9]+::\w+::\w+(<0x[a-f0-9]+::\w+::\w+>)?$/i.test(coinType);
  
  return hasValidStructure;
}

/**
 * Validate numeric input for token amounts
 * Prevents overflow and invalid numbers
 * @param {string|number} value - Value to validate
 * @param {number} decimals - Token decimals
 * @returns {boolean} True if valid amount
 */
export function isValidTokenAmount(value, decimals = 8) {
  if (value === null || value === undefined || value === '') {
    return false;
  }

  const numValue = Number(value);
  
  // Check if valid number
  if (isNaN(numValue) || !isFinite(numValue)) {
    return false;
  }

  // Must be positive
  if (numValue <= 0) {
    return false;
  }

  // Max value check (prevent overflow)
  const maxRawValue = Math.pow(10, decimals + 18); // max u256
  if (numValue * Math.pow(10, decimals) > maxRawValue) {
    return false;
  }

  // Check decimal places don't exceed precision
  const decimalPlaces = String(value).split('.')[1]?.length || 0;
  if (decimalPlaces > decimals) {
    return false;
  }

  return true;
}

/**
 * Validate percentage input (0-100)
 * @param {string|number} value - Percentage value
 * @returns {boolean} True if valid percentage
 */
export function isValidPercentage(value) {
  const numValue = Number(value);
  
  if (isNaN(numValue) || !isFinite(numValue)) {
    return false;
  }

  return numValue >= 0 && numValue <= 100;
}

/**
 * Sanitize string input to prevent XSS
 * Removes dangerous characters and encodes HTML entities
 * @param {string} input - String to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
export function sanitizeString(input, maxLength = 500) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = String(input)
    .trim()
    .slice(0, maxLength);

  // Remove control characters and null bytes
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Encode HTML entities to prevent XSS
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };

  sanitized = sanitized.replace(/[&<>"'\/]/g, char => entityMap[char]);

  return sanitized;
}

/**
 * Validate URL is safe to use
 * Prevents javascript: and data: protocol attacks
 * @param {string} url - URL to validate
 * @returns {boolean} True if safe URL
 */
export function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    
    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }

    // Block localhost in production
    if (process.env.NODE_ENV === 'production') {
      if (['localhost', '127.0.0.1', '0.0.0.0'].includes(urlObj.hostname)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate email address format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate username format
 * Allows alphanumeric, hyphens, underscores
 * @param {string} username - Username to validate
 * @returns {boolean} True if valid username
 */
export function isValidUsername(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }

  const trimmed = username.trim();
  
  // 3-50 characters, alphanumeric + underscore/hyphen
  const usernameRegex = /^[a-zA-Z0-9_-]{3,50}$/;
  return usernameRegex.test(trimmed);
}

/**
 * Validate transaction hash format
 * @param {string} hash - Transaction hash
 * @returns {boolean} True if valid hash
 */
export function isValidTxHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  const normalized = String(hash).trim().toLowerCase();
  
  // 0x followed by hexadecimal characters (32-66 chars for various chains)
  const hashRegex = /^0x[a-f0-9]{64}$/i;
  return hashRegex.test(normalized);
}

/**
 * Rate limit input processing
 * Prevents rapid-fire requests
 * @param {Function} fn - Function to rate limit
 * @param {number} delayMs - Minimum delay between calls
 * @returns {Function} Rate-limited function
 */
export function rateLimit(fn, delayMs = 1000) {
  let lastCallTime = 0;
  
  return function (...args) {
    const now = Date.now();
    if (now - lastCallTime >= delayMs) {
      lastCallTime = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * Validate input data against schema
 * Simple object validation
 * @param {Object} data - Data to validate
 * @param {Object} schema - Validation schema
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateSchema(data, schema) {
  const errors = [];

  for (const [key, validator] of Object.entries(schema)) {
    if (!validator.optional && !(key in data)) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }

    if (key in data) {
      const value = data[key];
      
      // Type check
      if (validator.type && typeof value !== validator.type) {
        errors.push(`${key} must be ${validator.type}, got ${typeof value}`);
      }

      // Custom validation function
      if (validator.validate && !validator.validate(value)) {
        errors.push(validator.error || `${key} validation failed`);
      }

      // Min/Max for numbers
      if (validator.min !== undefined && value < validator.min) {
        errors.push(`${key} must be >= ${validator.min}`);
      }

      if (validator.max !== undefined && value > validator.max) {
        errors.push(`${key} must be <= ${validator.max}`);
      }

      // Length for strings
      if (validator.minLength && value.length < validator.minLength) {
        errors.push(`${key} must be at least ${validator.minLength} characters`);
      }

      if (validator.maxLength && value.length > validator.maxLength) {
        errors.push(`${key} must be at most ${validator.maxLength} characters`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  isValidAddress,
  isValidCoinType,
  isValidTokenAmount,
  isValidPercentage,
  isValidUrl,
  isValidEmail,
  isValidUsername,
  isValidTxHash,
  sanitizeAddress,
  sanitizeString,
  rateLimit,
  validateSchema
};
