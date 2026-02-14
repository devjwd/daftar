/**
 * Movement Network DeFi Indexer Service
 * Queries the Movement GraphQL API for DeFi positions and protocol data
 * Endpoints: https://indexer.mainnet.movementnetwork.xyz/v1/graphql
 */

import { DEFAULT_NETWORK } from "../config/network";

/**
 * Known DeFi protocol contract addresses on Movement Network
 * These are verified mainnet addresses for major protocols
 */
export const DEFI_PROTOCOLS = {
  // Echelon Finance - Lending Protocol
  ECHELON: {
    name: "Echelon",
    address: "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5",
    type: "Lending",
    website: "https://echelon.finance",
  },
  
  // Joule Finance - Lending & Borrowing
  JOULE: {
    name: "Joule Finance",
    address: "0x2fe576faa841347a9b1b32c869685deb75a15e3f62dfe37cbd6d52cc403a16f6",
    type: "Lending",
    website: "https://joule.finance",
  },
  
  // MovePosition - Lending Protocol
  MOVEPOSITION: {
    name: "MovePosition",
    address: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf",
    type: "Lending",
    website: "https://moveposition.xyz",
  },
  
  // Meridian - Stablecoin & CDP Protocol
  MERIDIAN: {
    name: "Meridian",
    address: "0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82",
    type: "CDP",
    website: "https://app.meridian.money/",
  },
  
  // Razor DEX - AMM
  RAZOR: {
    name: "Razor DEX",
    address: "0x7730cd28ee1cdc9e999336cbc430f99e7c44397c0aa77516f6f23a78559bb5",
    type: "DEX",
    website: "https://razor.exchange",
  },
  
  // Yuzu Swap - CLMM DEX
  YUZU: {
    name: "Yuzu Swap",
    address: "0x4bf51972879e3b95c4781a5cdcb9e1ee24ef483e7d22f2d903626f126df62bd1",
    type: "DEX",
    website: "https://yuzu.swap",
  },
};

/**
 * Get indexer endpoint
 */
const getIndexerEndpoint = () => {
  return DEFAULT_NETWORK.indexer || "https://indexer.mainnet.movementnetwork.xyz/v1/graphql";
};

/**
 * Normalize address for GraphQL (lowercase, with 0x prefix)
 */
const normalizeAddress = (address) => {
  if (!address) return "";
  let normalized = String(address).trim();
  
  // Handle AccountAddress objects
  if (typeof normalized === "object" && normalized.toString) {
    normalized = normalized.toString();
  }
  
  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }
  
  return normalized.toLowerCase();
};

/**
 * Execute GraphQL query against Movement Indexer
 */
const queryIndexer = async (query, variables = {}) => {
  const endpoint = getIndexerEndpoint();
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Indexer error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      console.warn("GraphQL warnings:", result.errors);
    }

    return result.data;
  } catch (error) {
    console.error("DeFi indexer query failed:", error);
    return null;
  }
};

/**
 * Query fungible asset activities for a user to detect DeFi interactions
 */
export const getUserDeFiActivity = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  
  const query = `
    query GetUserDeFiActivity($address: String!) {
      fungible_asset_activities(
        where: {
          owner_address: { _eq: $address }
        }
        order_by: { transaction_timestamp: desc }
        limit: 100
      ) {
        transaction_version
        transaction_timestamp
        amount
        asset_type
        type
        is_transaction_success
      }
    }
  `;
  
  const data = await queryIndexer(query, { address: normalizedAddress });
  return data?.fungible_asset_activities || [];
};

/**
 * Query account transactions to find DeFi protocol interactions
 */
export const getUserProtocolInteractions = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  
  const query = `
    query GetAccountTransactions($address: String!) {
      account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: desc }
        limit: 200
      ) {
        transaction_version
        fungible_asset_activities {
          amount
          asset_type
          type
          transaction_timestamp
        }
      }
    }
  `;
  
  const data = await queryIndexer(query, { address: normalizedAddress });
  return data?.account_transactions || [];
};

/**
 * Get current fungible asset balances that might be DeFi receipt tokens
 */
export const getDeFiTokenBalances = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  
  const query = `
    query GetUserFungibleAssets($address: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address }
          amount: { _gt: "0" }
        }
      ) {
        asset_type
        amount
        last_transaction_timestamp
        metadata {
          name
          symbol
          decimals
          asset_type
        }
      }
    }
  `;
  
  const data = await queryIndexer(query, { address: normalizedAddress });
  const balances = data?.current_fungible_asset_balances || [];
  
  // Filter for potential DeFi tokens (receipts, LP tokens, etc.)
  const defiTokenPatterns = [
    "::lp::",
    "::share::",
    "::receipt::",
    "::vault::",
    "::lending::",
    "::pool::",
    "::stake::",
    "LPCoin",
    "ShareToken",
    "ReceiptToken",
  ];
  
  return balances.filter(b => {
    const assetType = b.asset_type?.toLowerCase() || "";
    return defiTokenPatterns.some(pattern => 
      assetType.includes(pattern.toLowerCase())
    );
  });
};

/**
 * Detect which protocols a user has interacted with
 */
export const detectUserProtocols = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  const interactions = await getUserProtocolInteractions(normalizedAddress);
  
  const detectedProtocols = new Set();
  
  interactions.forEach(tx => {
    tx.fungible_asset_activities?.forEach(activity => {
      const assetType = activity.asset_type?.toLowerCase() || "";
      
      // Check against known protocol addresses
      Object.entries(DEFI_PROTOCOLS).forEach(([key, protocol]) => {
        if (assetType.includes(protocol.address.toLowerCase())) {
          detectedProtocols.add(key);
        }
      });
    });
  });
  
  return Array.from(detectedProtocols).map(key => ({
    ...DEFI_PROTOCOLS[key],
    key,
  }));
};

export default {
  DEFI_PROTOCOLS,
  getUserDeFiActivity,
  getUserProtocolInteractions,
  getDeFiTokenBalances,
  detectUserProtocols,
};
