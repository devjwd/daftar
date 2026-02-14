// Movement Network Mainnet Token Registry
// Contract addresses for major tokens on Movement Network

export const MOVEMENT_TOKENS = {
  // Native MOVE token (0xa is the framework address, also 0x1 for Aptos-compatible)
  "0xa": {
    symbol: "MOVE",
    name: "Movement",
    decimals: 8,
    address: "0xa",
    isNative: true,
    verified: true,
  },
  "0x1": {
    symbol: "MOVE",
    name: "Movement",
    decimals: 8,
    address: "0x1",
    isNative: true,
    verified: true,
  },
  // USDT on Movement Mainnet
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    address: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d",
    isNative: false,
    verified: true,
  },
  // USDC on Movement Mainnet
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    address: "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39",
    isNative: false,
    verified: true,
  },
  // WETH on Movement Mainnet
  "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376": {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 8,
    address: "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376",
    isNative: false,
    verified: true,
  },
  // WBTC on Movement Mainnet
  "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c": {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    address: "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c",
    isNative: false,
    verified: true,
  },
  // CAPY on Movement Mainnet
  "0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3": {
    symbol: "CAPY",
    name: "Capy",
    decimals: 8,
    address: "0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3",
    isNative: false,
    verified: true,
  },
  // MOVECAT on Movement Mainnet
  "0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a": {
    symbol: "MOVECAT",
    name: "MoveCat",
    decimals: 8,
    address: "0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a",
    isNative: false,
    verified: true,
  },
  // LBTC - Lombard BTC
  "0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c": {
    symbol: "LBTC",
    name: "Lombard BTC",
    decimals: 8,
    address: "0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c",
    isNative: false,
    verified: true,
  },
  // ezETH - Renzo Restaked ETH
  "0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef": {
    symbol: "ezETH",
    name: "Renzo Restaked ETH",
    decimals: 8,
    address: "0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef",
    isNative: false,
    verified: true,
  },
  // rsETH - Kelp Restaked ETH
  "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d": {
    symbol: "rsETH",
    name: "Kelp Restaked ETH",
    decimals: 8,
    address: "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d",
    isNative: false,
    verified: true,
  },
  // SolvBTC - Solv Protocol BTC
  "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d": {
    symbol: "SolvBTC",
    name: "Solv BTC",
    decimals: 8,
    address: "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d",
    isNative: false,
    verified: true,
  },
  // USDe - Ethena USD
  "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c": {
    symbol: "USDe",
    name: "Ethena USDe",
    decimals: 6,
    address: "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c",
    isNative: false,
    verified: true,
  },
  // USDa - Angle USD
  "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650": {
    symbol: "USDa",
    name: "Angle USD",
    decimals: 6,
    address: "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650",
    isNative: false,
    verified: true,
  },
  // weETH - Wrapped eETH
  "0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035": {
    symbol: "weETH",
    name: "Wrapped eETH",
    decimals: 8,
    address: "0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035",
    isNative: false,
    verified: true,
  },
};

/**
 * Get token info by address (normalized)
 * @param {string} address - Token address
 * @returns {Object|null} Token info or null
 */
export function getTokenInfo(address) {
  if (!address) return null;
  
  // Normalize address (lowercase, ensure 0x prefix)
  let normalized = String(address).toLowerCase().trim();
  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }
  
  // Check exact match first
  if (MOVEMENT_TOKENS[normalized]) {
    return MOVEMENT_TOKENS[normalized];
  }
  
  // For short addresses like 0xa, also check without padding
  // Movement addresses can be represented in different formats
  const shortAddresses = ["0xa", "0x1"];
  if (shortAddresses.includes(normalized)) {
    return MOVEMENT_TOKENS[normalized];
  }
  
  // For full addresses, check with and without 0x prefix
  const withoutPrefix = normalized.replace(/^0x/, "");
  if (MOVEMENT_TOKENS[`0x${withoutPrefix}`]) {
    return MOVEMENT_TOKENS[`0x${withoutPrefix}`];
  }
  
  return null;
}

/**
 * Check if address is a known token
 * @param {string} address - Token address
 * @returns {boolean} True if known token
 */
export function isKnownToken(address) {
  return getTokenInfo(address) !== null;
}

