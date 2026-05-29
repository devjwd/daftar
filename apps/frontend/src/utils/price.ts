/**
 * Resolves a token price from the price map using various fallbacks (address, symbol, and hardcoded values).
 */
export const resolveTokenPrice = (
  priceMap: Record<string, number>,
  address?: string,
  symbol?: string,
  fullType?: string
): number => {
  if (!priceMap) return 0;

  // 1. Try direct address lookup
  if (address && priceMap[address]) {
    return priceMap[address];
  }

  // 2. Try fullType lookup
  if (fullType && priceMap[fullType]) {
    return priceMap[fullType];
  }

  // 3. Normalized address lookup (remove leading zeros)
  if (address) {
    const normalized = address.toLowerCase().replace(/^0x0+/, "0x");
    if (priceMap[normalized]) return priceMap[normalized];
  }

  // 4. Symbol based fallbacks
  const upperSymbol = String(symbol || '').toUpperCase();

  // MOVE
  const isMove = upperSymbol === "MOVE" || upperSymbol === "GMOVE" || upperSymbol === "STMOVE" || upperSymbol === "LMOVE" || upperSymbol === "CVMOVE";
  const isMoveDrops = upperSymbol.includes('DROPS');

  if (isMove && !isMoveDrops) {
    return priceMap["0xa"] || priceMap["0x1"] || 0.01806;
  }

  // Stables
  if (["USDC", "USDT", "USDCX", "USDA", "USDE", "SUSDE"].some(s => upperSymbol === s || upperSymbol.includes(s))) {
    return 1.0;
  }

  // ETH
  if (["ETH", "WETH", "EZETH", "RSETH", "WEETH"].some(s => upperSymbol === s || upperSymbol.includes(s))) {
    return priceMap["0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376"] || 2331.60;
  }

  // BTC
  if (["BTC", "WBTC", "LBTC", "SOLVBTC"].some(s => upperSymbol === s || upperSymbol.includes(s))) {
    return priceMap["0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c"] || 81096.63;
  }

  return 0;
};
