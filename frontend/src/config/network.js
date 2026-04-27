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
 * Admin Address - only this wallet can access the admin panel.
 * Set VITE_ADMIN_ADDRESS in .env, or falls back to the deployed contract address.
 */
export const ADMIN_ADDRESS = (
  _env.VITE_ADMIN_ADDRESS ||
  _env.VITE_SWAP_ROUTER_ADDRESS ||
  "0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69"
).toLowerCase();

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
  packageAddress: "0x4bf51972879e3b95c4781a5cdcb9e1ee24ef483e7d22f2d903626f126df62bd1",
  defaultFeeTier: 2500, // 0.25%
};

/**
 * Canopy Finance Configuration
 */
export const CANOPY_CONFIG = {
  coreRouterAddress: getEnv(
    'VITE_CANOPY_CORE_ROUTER_ADDRESS',
    '0x717b417949cd5bfa6dc02822eacb727d820de2741f6ea90bf16be6c0ed46ff4b'
  ),
  coreVaultsAddress: getEnv(
    'VITE_CANOPY_CORE_VAULTS_ADDRESS',
    '0xb10bd32b3979c9d04272c769d9ef52afbc6edc4bf03982a9e326b96ac25e7f2d'
  ),
  liquidswapVaultsAddress: getEnv(
    'VITE_CANOPY_LIQUIDSWAP_VAULTS_ADDRESS',
    '0x5cd341a0cd4c2fb8d9e342814c00d7b388ad7579365d657ebb5b18e35c3c761b'
  ),
  rewardsAddress: getEnv(
    'VITE_CANOPY_REWARDS_ADDRESS',
    '0x113a1769acc5ce21b5ece6f9533eef6dd34c758911fa5235124c87ff1298633b'
  ),
};

