/**
 * Movement Network Configuration
 * Documentation: https://docs.movementnetwork.xyz
 */
import { getEnv } from "./envValidator.js";

export const NETWORKS = {
  MAINNET: {
    name: "Mainnet",
    rpc: "https://mainnet.movementnetwork.xyz/v1",
    explorer: "https://explorer.movementnetwork.xyz",
    indexer: "https://indexer.mainnet.movementnetwork.xyz/v1/graphql",
  },
  TESTNET: {
    name: "Testnet",
    rpc: "https://testnet.movementnetwork.xyz/v1",
    explorer: "https://explorer-testnet.movementnetwork.xyz",
    indexer: "https://hasura.testnet.movementnetwork.xyz/v1/graphql",
  },
};

// Default network (can be overridden by env variable)
// Vite uses import.meta.env; plain Node scripts should fall back to process.env.
// `import.meta` is only defined in module environments, so guard accordingly.
const _env =
  (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env :
  (typeof globalThis !== 'undefined' && globalThis.process?.env ? globalThis.process.env : {});

export const DEFAULT_NETWORK = _env.VITE_NETWORK === "testnet" 
  ? NETWORKS.TESTNET 
  : NETWORKS.MAINNET;

// Common token decimals mapping
// Movement tokens typically use 8 decimals, but some may differ
export const TOKEN_DECIMALS = {
  // Default for most Movement tokens
  default: 8,
  // Add specific token decimals here as needed
  // Format: "0x1::coin::CoinStore<0x...::mod::SYMBOL>": decimals
};

/**
 * Swap Router Configuration
 * Note: Deploy the contract in contracts/swap_router/ and update this address
 */
export const SWAP_ROUTER_ADDRESS = _env.VITE_SWAP_ROUTER_ADDRESS || null;

/**
 * Badge System Configuration
 * Set VITE_BADGE_SBT_MODULE_ADDRESS (preferred) or VITE_BADGE_MODULE_ADDRESS in .env
 */
export const BADGE_MODULE_ADDRESS =
  _env.VITE_BADGE_SBT_MODULE_ADDRESS || _env.VITE_BADGE_MODULE_ADDRESS || null;

/**
 * Mosaic DEX Aggregator Configuration
 * Documentation: https://docs.mosaic.ag/
 */
export const MOSAIC_CONFIG = {
  apiUrl: getEnv('VITE_MOSAIC_API_URL', 'https://api.mosaic.ag/v1'),
  routerAddress: "0xede23ef215f0594e658b148c2a391b1523335ab01495d8637e076ec510c6ec3c",
};

/**
 * Yuzu CLMM Configuration
 * Documentation: https://docs.yuzu.finance/
 */
export const YUZU_CONFIG = {
  packageAddress: "0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f",
  defaultFeeTier: 2500, // 0.25%
};

