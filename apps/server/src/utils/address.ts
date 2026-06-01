/**
 * Unified Address Normalization for Movement (Aptos-based)
 */
export const normalizeAddress = (value: string | null | undefined): string => {
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
 * Validates if two addresses are the same
 */
export const isSameAddress = (addr1: string, addr2: string): boolean => {
  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);
  return norm1 !== '' && norm1 === norm2;
};
