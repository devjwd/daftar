/**
 * Address normalization utilities for Movement Network
 */

/**
 * Normalizes a wallet address to a consistent format
 * - Ensures 0x prefix
 * - Converts to lowercase
 * - Handles short addresses (e.g. 0x1 -> 0x0...1)
 */
export const normalizeAddress = (address: string | null | undefined): string => {
  if (!address) return "";
  
  let normalized = String(address).trim().toLowerCase();
  
  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }
  
  // Standardize 64-character hex (plus 0x prefix = 66 chars)
  if (normalized.length < 66 && normalized !== "0x") {
    const hex = normalized.slice(2);
    normalized = `0x${hex.padStart(64, "0")}`;
  }
  
  return normalized;
};

/**
 * Checks if two addresses are equal after normalization
 */
export const areAddressesEqual = (addr1: string | null, addr2: string | null): boolean => {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
};

/**
 * Shortens an address for display (e.g. 0x1234...5678)
 */
export const shortenAddress = (address: string | null, chars: number = 4): string => {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized === "0x") return "";
  return `${normalized.slice(0, chars + 2)}...${normalized.slice(-chars)}`;
};
