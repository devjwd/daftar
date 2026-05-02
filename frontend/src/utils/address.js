/**
 * Unified Address Normalization for Movement (Aptos-based)
 * Standardizes to 0x + 64 hex characters, lowercased.
 * 
 * Handles:
 * 1. Simple hex strings
 * 2. Wallet adapter AccountAddress objects
 * 3. Buffer/Uint8Array data
 */
export const normalizeAddress = (address) => {
  if (!address) return '';

  let normalized = address;

  // 1. Handle wallet adapter AccountAddress objects or other complex objects
  if (typeof address === "object") {
    if (typeof address.toString === "function" && address.toString() !== "[object Object]") {
      normalized = address.toString();
    } else if (typeof address.hex === "function") {
      normalized = address.hex();
    } else if (address.data && (address.data instanceof Uint8Array || Array.isArray(address.data))) {
      const hex = Array.from(address.data)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      normalized = `0x${hex}`;
    }
  }

  const raw = String(normalized || '').trim().toLowerCase();
  
  // 2. Remove 0x prefix if exists for manipulation
  let stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  
  // 3. Validate it's a hex string
  if (!/^[a-f0-9]+$/i.test(stripped)) return '';
  
  // 4. Pad to 64 chars (32 bytes) for Movement/Aptos consistency
  return `0x${stripped.padStart(64, '0')}`;
};

/**
 * Shortens a normalized address for UI display
 * e.g., 0x000...abc -> 0x000...abc
 */
export const shortenAddress = (address, chars = 4) => {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  if (normalized.length <= (chars * 2) + 5) return normalized;
  return `${normalized.substring(0, chars + 2)}...${normalized.substring(66 - chars)}`;
};

/**
 * Compares two addresses for equality safely
 */
export const isSameAddress = (addr1, addr2) => {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
};
