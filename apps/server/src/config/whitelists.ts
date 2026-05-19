/**
 * Centralized Whitelists & Constants for Analytics
 * 
 * Moved from inline route handlers to a config file so they can be
 * updated without touching route/service code.
 */

/** Integrated DeFi protocols on Movement Network */
export const WHITELIST_PROTOCOLS = new Set([
  'Liquidswap', 'Echelon', 'Movement Core', 'Aries', 'Mosaic',
  'Yuzu', 'LayerBank', 'Canopy', 'MovePosition', 'Joule',
  'Meridian', 'Razor', 'Move Match'
]);

/** Known Centralized Exchanges */
export const KNOWN_EXCHANGES = new Set([
  'Binance', 'OKX', 'Coinbase', 'MEXC', 'Gate', 'Bitget', 'KuCoin', 'Bybit', 'Kraken'
]);

/** Integrated/Verified Token Symbols */
export const WHITELIST_TOKENS = new Set([
  'MOVE', 'USDT', 'USDT.e', 'USDC', 'USDC.e', 'ETH', 'WETH', 'BTC',
  'WBTC', 'rsETH', 'gMOVE', 'cvMOVE', 'stMOVE', 'USDe', 'ezETH', 'weETH',
  'SolvBTC', 'LBTC', 'USDCx', 'USDa'
]);

/**
 * Symbols that are known scam/airdrop/test tokens — exclude from balance snapshots.
 * These tokens have no real value and inflate portfolio numbers.
 */
export const BLACKLIST_TOKEN_SYMBOLS = new Set([
  // Scam / airdrop tokens
  'TEST', 'CAPY', 'MOVECAT',
  // Move-branded airdrops/reward tokens (not the real MOVE)
  'MOVE Drops', 'MOVE Drop', 'MOVE Gift', 'MOVE Rwd', 'MOVEReward',
  'MOVEDrop', 'MOVEGift', 'MOVERwd', 'MOVEREWARD',
  // Illiquid governance / wrapped variants that should not count
  'lMOVE', 'dMOVE',
]);

/**
 * Asset type substrings that indicate the token is an LP position,
 * not a real token holding. Exclude from balance snapshots.
 */
export const BLACKLIST_ASSET_TYPE_PATTERNS: string[] = [
  '-LP',      // MER-LP, etc.
  '_LP',
  '::LP',
  '::lp_',
  'LPToken',
  'LpToken',
  'lptoken',
  'liquidity_pool',
  'LiquidityPool',
  'pool_token',
  '::pair::',
  '::Pair::',
];

/**
 * Asset type substrings that belong to Aptos (not Movement Network).
 * These should be ignored and normalized to MOVE where applicable.
 */
export const APTOS_COIN_PATTERNS: string[] = [
  '::aptos_coin::AptosCoin',
  '::aptos_coin::aptoscoin',
];

/**
 * Returns true if the asset type or symbol should be excluded from
 * balance snapshots (scam, airdrop, LP token, or raw Aptos coin type).
 */
export function isJunkAsset(assetType: string, symbol: string): boolean {
  const sym = symbol.trim();
  const type = assetType.toLowerCase();

  // Blacklisted symbol (exact match, case-insensitive)
  if (BLACKLIST_TOKEN_SYMBOLS.has(sym)) return true;

  // Starts with known airdrop-style prefixes
  if (/^MOVE\s+(Drop|Gift|Rwd|Reward)/i.test(sym)) return true;

  // LP token patterns in asset type
  if (BLACKLIST_ASSET_TYPE_PATTERNS.some(p => assetType.includes(p) || type.includes(p.toLowerCase()))) return true;

  // Raw Aptos coin type (no real Aptos token on Movement Network)
  if (APTOS_COIN_PATTERNS.some(p => assetType.includes(p))) return true;

  return false;
}

/** Protocol chart colors (cycled via index) */
export const PROTOCOL_COLORS = [
  '#cda169', '#36c690', '#7b68ee', '#e06a6a', '#ffa500',
  '#00ced1', '#ff69b4', '#9370db', '#20b2aa', '#f0e68c',
  '#dda0dd', '#87ceeb'
];

/** Inflow action types */
export const INFLOW_ACTIONS = ['RECEIVE', 'WITHDRAW', 'CLAIM', 'BORROW', 'UNSTAKE', 'NFT_SALE'] as const;

/** Outflow action types */
export const OUTFLOW_ACTIONS = ['SEND', 'DEPOSIT', 'LEND', 'REPAY', 'STAKE', 'NFT_BUY'] as const;

/** Maximum transactions to fetch per analytics request (memory safety) */
export const MAX_ANALYTICS_TRANSACTIONS = 10000;

/** Page size for Supabase pagination */
export const ANALYTICS_PAGE_SIZE = 1000;
