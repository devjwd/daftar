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
  'WBTC', 'rsETH', 'gMOVE', 'stMOVE', 'USDe', 'ezETH', 'weETH',
  'SolvBTC', 'LBTC', 'USDCx', 'USDa'
]);

/**
 * Symbols that are known scam/airdrop/test tokens — exclude from balance snapshots.
 * These tokens have no real value and inflate portfolio numbers.
 */
export const BLACKLIST_TOKEN_SYMBOLS = new Set([
  // Scam / airdrop tokens
  'TEST', 'CAPY', 'MOVECAT', 'DELAY', 'DASD',
  // Move-branded airdrops/reward tokens (not the real MOVE)
  'MOVE Drops', 'MOVE Drop', 'MOVE Gift', 'MOVE Rwd', 'MOVEReward',
  'MOVEDrop', 'MOVEGift', 'MOVERwd', 'MOVEREWARD',
  // LP tokens without standard LP suffix
  'MOVE-USDTU',
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
 * All addresses that resolve to the native MOVE token (canonical: 0x1).
 * The indexer may return MOVE balances under any of these addresses.
 * They must all be merged into a single balance entry to avoid duplicates.
 */
export const NATIVE_MOVE_ADDRESSES = new Set([
  '0x1',
  '0xa',
  '0x000000000000000000000000000000000000000000000000000000000000000a',
  '0x0000000000000000000000000000000000000000000000000000000000000001',
]);

/**
 * Liquid Staking Tokens (LSTs) that should inherit their underlying token's price.
 * Key = symbol, Value = canonical address of the underlying token.
 */
export const LST_PRICE_ALIASES: Record<string, string> = {
  'gMOVE': '0x1',   // Gravity MOVE LST → MOVE price
  'stMOVE': '0x1',  // Staked MOVE LST → MOVE price
  'cvMOVE': '0x1',  // Canopy Vault MOVE LST → MOVE price
  'cvWBTC.e': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c', // Canopy Vault WBTC LST → WBTC price
  'cvWETH.e': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376', // Canopy Vault WETH LST → WETH price
  'cvWBTC': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
  'cvWETH': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
};

/**
 * Returns true if the asset type or symbol should be excluded from
 * balance snapshots (scam, airdrop, LP token, or raw Aptos coin type).
 */
export function isJunkAsset(assetType: string, symbol: string): boolean {
  const sym = symbol.trim();
  const symLower = sym.toLowerCase();
  const type = assetType.toLowerCase();

  // Blacklisted symbol (exact match, case-insensitive)
  if (BLACKLIST_TOKEN_SYMBOLS.has(sym)) return true;

  // Starts with known airdrop-style prefixes
  if (/^MOVE\s+(Drop|Gift|Rwd|Reward)/i.test(sym)) return true;

  // LP token patterns in asset type
  if (BLACKLIST_ASSET_TYPE_PATTERNS.some(p => assetType.includes(p) || type.includes(p.toLowerCase()))) return true;

  // LP token patterns in symbol
  const lpPatterns = ['lp', 'lpt', 'lptoken', 'pooltoken', 'pool_token', 'liquidity', 'pair', 'pool-token'];
  if (lpPatterns.some(p => symLower === p || symLower.includes('-' + p) || symLower.includes('_' + p) || symLower.includes(' ' + p) || symLower.includes(p + '-') || symLower.includes(p + '_') || symLower.includes(p + ' '))) return true;
  if (symLower.endsWith('lp') || symLower.startsWith('lp')) return true;

  // Lending Receipt Tokens (eMOVE, jMOVE, uMOVE, pmMOVE, etc.)
  const baseSymbols = ['MOVE', 'USDT', 'USDC', 'ETH', 'BTC', 'WETH', 'USDT.e', 'USDC.e'];
  for (const base of baseSymbols) {
    const baseLower = base.toLowerCase();
    if (symLower === `e${baseLower}` || symLower === `j${baseLower}` || symLower === `u${baseLower}` || symLower === `pm${baseLower}`) return true;
  }

  // LP NFT and position patterns in symbol
  const nftPositionPatterns = ['position', 'pos', 'lp-nft', 'lpnft', 'badge', 'ticket', 'card', 'nft'];
  if (nftPositionPatterns.some(p => symLower === p || symLower.includes(p) || symLower.includes('-' + p) || symLower.includes('_' + p))) return true;

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
export const INFLOW_ACTIONS = ['RECEIVED', 'WITHDRAW', 'CLAIM', 'BORROW', 'UNSTAKE', 'NFT_SALE', 'YIELD'] as const;

/** Outflow action types */
export const OUTFLOW_ACTIONS = ['SEND', 'DEPOSIT', 'LEND', 'REPAY', 'STAKE', 'NFT_BUY', 'LIQUIDITY'] as const;

/** Maximum transactions to fetch per analytics request (memory safety) */
export const MAX_ANALYTICS_TRANSACTIONS = 10000;

/** Page size for Supabase pagination */
export const ANALYTICS_PAGE_SIZE = 1000;
