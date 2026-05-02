/**
 * Unified Address Normalization for Movement (Aptos-based)
 * 
 * Ensures addresses are always:
 * 1. Lowercased
 * 2. Padded to 64 hex characters (32 bytes)
 * 3. Prefixed with 0x
 */
export const normalizeAddress = (value) => {
  if (!value) return '';
  const raw = String(value).trim().toLowerCase();
  
  // Remove 0x prefix if exists for manipulation
  let stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  
  // Validate it's a hex string
  if (!/^[a-f0-9]+$/i.test(stripped)) return '';
  
  // Pad to 64 chars
  return `0x${stripped.padStart(64, '0')}`;
};

/**
 * Validates if two addresses are the same (case-insensitive, padding-insensitive)
 */
export const isSameAddress = (addr1, addr2) => {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
};
