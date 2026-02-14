// Token utility functions for Movement Network
import { getTokenInfo } from "../config/tokens";

/**
 * Extract token metadata from coin type string
 * @param {string} coinType - Full coin type string (e.g., "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>")
 * @returns {Object} Token metadata
 */
export function parseCoinType(coinType) {
  const match = coinType.match(/<(.+)>/);
  if (!match) return null;
  
  const fullType = match[1];
  const parts = fullType.split("::");
  const address = parts[0];
  const module = parts[1] || "";
  const namePart = parts[2] || parts[parts.length - 1] || "";
  
  // Check if this is a known token by address
  let tokenInfo = getTokenInfo(address);
  
  // Special handling for native MOVE token (0x1::aptos_coin::AptosCoin or similar)
  if (!tokenInfo && (address === "0x1" || address === "0xa") && 
      (module.includes("coin") || namePart.includes("Aptos") || namePart.includes("Move"))) {
    tokenInfo = {
      symbol: "MOVE",
      name: "Movement",
      decimals: 8,
      address: address,
      isNative: true,
    };
  }
  
  return {
    fullType,
    address: address,
    module: module,
    name: tokenInfo?.name || namePart || "Unknown",
    symbol: tokenInfo?.symbol || namePart || "UNKNOWN",
    isKnown: !!tokenInfo,
    tokenInfo: tokenInfo,
  };
}

/**
 * Get token decimals (defaults to 8 for Movement tokens)
 * @param {string} coinType - Full coin type string
 * @param {Object} tokenMeta - Optional token metadata from parseCoinType
 * @returns {number} Number of decimals
 */
export function getTokenDecimals(coinType, tokenMeta = null) {
  // If we have token metadata with known token info, use that
  if (tokenMeta?.tokenInfo?.decimals) {
    return tokenMeta.tokenInfo.decimals;
  }
  
  // Try to get from token registry by parsing the address
  const match = coinType.match(/<(.+)>/);
  if (match) {
    const fullType = match[1];
    const parts = fullType.split("::");
    const address = parts[0];
    const tokenInfo = getTokenInfo(address);
    if (tokenInfo?.decimals) {
      return tokenInfo.decimals;
    }
  }
  
  // Default to 8 decimals for Movement tokens
  return 8;
}

/**
 * Format token amount with proper decimals
 * @param {string|number} rawValue - Raw token value as string
 * @param {number} decimals - Number of decimals
 * @param {number} displayDecimals - Number of decimals to display (default: 2)
 * @returns {string} Formatted amount
 */
export function formatTokenAmount(rawValue, decimals = 8, displayDecimals = 2) {
  const value = typeof rawValue === "string" ? rawValue : String(rawValue);
  const divisor = Math.pow(10, decimals);
  const amount = Number(value) / divisor;
  
  // Format with appropriate precision
  if (amount === 0) return "0.00";
  if (amount < 0.01) return amount.toFixed(displayDecimals + 2);
  return amount.toFixed(displayDecimals);
}

/**
 * Format address for display
 * @param {string} address - Full address
 * @param {number} startChars - Characters to show at start (default: 6)
 * @param {number} endChars - Characters to show at end (default: 4)
 * @returns {string} Formatted address
 */
export function formatAddress(address, startChars = 6, endChars = 4) {
  if (!address) return "";
  const addressStr = String(address).trim();
  if (addressStr.length < startChars + endChars) return addressStr;
  return `${addressStr.slice(0, startChars)}...${addressStr.slice(-endChars)}`;
}

/**
 * Validate Movement Network address
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid
 */
export function isValidAddress(address) {
  if (!address) return false;
  // Movement Network supports both short (0x1, 0xa) and full (64 hex chars) addresses
  // This regex accepts 1-64 hex characters after 0x prefix
  const addressPattern = /^0x[a-fA-F0-9]{1,64}$/;
  return addressPattern.test(String(address).trim());
}

