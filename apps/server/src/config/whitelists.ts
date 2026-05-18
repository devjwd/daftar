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
  'WBTC', 'rsETH', 'gMOVE', 'cvMOVE', 'stMOVE', 'APT', 'USDe'
]);

/** Protocol chart colors (cycled via index) */
export const PROTOCOL_COLORS = [
  '#cda169', '#36c690', '#7b68ee', '#e06a6a', '#ffa500',
  '#00ced1', '#ff69b4', '#9370db', '#20b2aa', '#f0e68c',
  '#dda0dd', '#87ceeb'
];

/** Inflow action types */
export const INFLOW_ACTIONS = ['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN'] as const;

/** Outflow action types */
export const OUTFLOW_ACTIONS = ['SEND', 'DEPOSIT', 'BORROW', 'BRIDGE_OUT'] as const;

/** Maximum transactions to fetch per analytics request (memory safety) */
export const MAX_ANALYTICS_TRANSACTIONS = 10000;

/** Page size for Supabase pagination */
export const ANALYTICS_PAGE_SIZE = 1000;
