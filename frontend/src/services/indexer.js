/**
 * Movement Network Indexer Service
 * GraphQL API client for querying Movement Network indexer
 * Documentation: https://docs.movementnetwork.xyz/devs/indexing
 */

import { DEFAULT_NETWORK } from "../config/network";

/**
 * Get the appropriate indexer endpoint based on network
 */
export const getIndexerEndpoint = () => {
  return DEFAULT_NETWORK.indexer;
};

/**
 * Execute a GraphQL query against the Movement Indexer
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query result
 */
export const queryIndexer = async (query, variables = {}) => {
  const endpoint = getIndexerEndpoint();
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    throw error;
  }
};

/**
 * Normalize address for GraphQL queries (lowercase, ensure 0x prefix)
 */
const normalizeAddress = (address) => {
  if (!address) return "";
  
  let normalized = String(address).trim();
  
  // Handle AccountAddress objects from SDK
  if (normalized.startsWith("0x") || /^[a-fA-F0-9]+$/.test(normalized)) {
    // Already looks like hex
  } else if (typeof normalized === "string" && normalized.length > 0) {
    // Try to extract hex from object string representation
    const hexMatch = normalized.match(/0x[a-fA-F0-9]+/i);
    if (hexMatch) {
      normalized = hexMatch[0];
    }
  }
  
  // Ensure 0x prefix
  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }
  
  // Lowercase for consistency (GraphQL is case-sensitive)
  normalized = normalized.toLowerCase();
  
  return normalized;
};

/**
 * Check if an account exists on chain (has any transactions or balances)
 * @param {string} address - Wallet address
 * @returns {Promise<{exists: boolean, txCount: number}>}
 */
export const checkAccountExists = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress || normalizedAddress === "0x") {
    return { exists: false, txCount: 0 };
  }

  const query = `
    query CheckAccountExists($address: String!) {
      account_transactions_aggregate(
        where: { account_address: { _eq: $address } }
      ) {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    return { exists: txCount > 0, txCount };
  } catch (error) {
    console.warn("checkAccountExists error:", error);
    return { exists: false, txCount: 0 };
  }
};

/**
 * Get user's token balances from indexer
 * More efficient than fetching all resources from RPC
 */
export const getUserTokenBalances = async (address) => {
  // Normalize address (GraphQL is case-sensitive)
  const normalizedAddress = normalizeAddress(address);
  
  const query = `
    query GetUserTokenBalances($address: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: {_eq: $address},
          amount: {_gt: "0"}
        }
      ) {
        asset_type
        amount
        last_transaction_timestamp
        metadata {
          name
          symbol
          decimals
          token_standard
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const balances = data?.current_fungible_asset_balances || [];
    return balances;
  } catch (error) {
    // Return empty array to trigger RPC fallback
    return [];
  }
};

/**
 * Get token activity history for an address
 */
export const getTokenActivityHistory = async (address, limit = 50) => {
  const query = `
    query GetAddressTokenHistory($address: String!, $limit: Int!) {
      account_transactions(
        where: {
          account_address: {_eq: $address}
        },
        order_by: {transaction_version: desc},
        limit: $limit
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

  const data = await queryIndexer(query, { address, limit });
  return data?.account_transactions || [];
};

/**
 * Track large token transfers
 */
export const getLargeTokenTransfers = async (threshold = "1000000000", limit = 100) => {
  const query = `
    query GetLargeTokenTransfers($threshold: String!, $limit: Int!) {
      fungible_asset_activities(
        where: {
          amount: {_gt: $threshold},
          type: {_in: ["0x1::coin::WithdrawEvent", "0x1::coin::DepositEvent"]}
        },
        order_by: {transaction_timestamp: desc},
        limit: $limit
      ) {
        transaction_version
        transaction_timestamp
        amount
        asset_type
        type
        owner_address
        is_transaction_success
      }
    }
  `;

  const data = await queryIndexer(query, { threshold, limit });
  return data?.fungible_asset_activities || [];
};

/**
 * Get wallet's first transaction timestamp to determine wallet age
 * @param {string} address - Wallet address
 * @returns {Promise<{firstTxTimestamp: string|null, txCount: number}>}
 */
export const getWalletAge = async (address) => {
  // Normalize address
  let normalizedAddress = String(address).trim().toLowerCase();
  if (!normalizedAddress.startsWith("0x")) {
    normalizedAddress = `0x${normalizedAddress}`;
  }

  const query = `
    query GetWalletAge($address: String!) {
      account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: asc }
        limit: 1
      ) {
        transaction_version
      }
      account_transactions_aggregate(
        where: { account_address: { _eq: $address } }
      ) {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const firstTx = data?.account_transactions?.[0];
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    
    // If we have a first transaction, fetch its timestamp
    if (firstTx?.transaction_version) {
      const timestampQuery = `
        query GetTxTimestamp($version: bigint!) {
          block_metadata_transactions(
            where: { version: { _lte: $version } }
            order_by: { version: desc }
            limit: 1
          ) {
            timestamp
          }
        }
      `;
      
      const tsData = await queryIndexer(timestampQuery, { 
        version: firstTx.transaction_version 
      });
      
      const timestamp = tsData?.block_metadata_transactions?.[0]?.timestamp;
      return { firstTxTimestamp: timestamp || null, txCount };
    }
    
    return { firstTxTimestamp: null, txCount };
  } catch (error) {
    console.warn("Failed to fetch wallet age:", error);
    return { firstTxTimestamp: null, txCount: 0 };
  }
};

/**
 * Get recent transaction history for portfolio chart
 * @param {string} address - Wallet address
 * @param {number} limit - Number of transactions to fetch
 * @returns {Promise<Array>}
 */
export const getRecentTransactions = async (address, limit = 30) => {
  let normalizedAddress = String(address).trim().toLowerCase();
  if (!normalizedAddress.startsWith("0x")) {
    normalizedAddress = `0x${normalizedAddress}`;
  }

  const query = `
    query GetRecentTxs($address: String!, $limit: Int!) {
      fungible_asset_activities(
        where: { 
          owner_address: { _eq: $address }
          is_transaction_success: { _eq: true }
        }
        order_by: { transaction_timestamp: desc }
        limit: $limit
      ) {
        transaction_timestamp
        amount
        asset_type
        type
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress, limit });
    return data?.fungible_asset_activities || [];
  } catch (error) {
    console.warn("Failed to fetch recent transactions:", error);
    return [];
  }
};

/**
 * Get user's NFT holdings (for LP position NFTs like Yuzu)
 * @param {string} address - Wallet address
 * @returns {Promise<Array>} Array of NFT holdings
 */
export const getUserNFTHoldings = async (address) => {
  let normalizedAddress = String(address).trim().toLowerCase();
  if (!normalizedAddress.startsWith("0x")) {
    normalizedAddress = `0x${normalizedAddress}`;
  }

  const query = `
    query GetUserNFTs($address: String!) {
      current_token_ownerships_v2(
        where: {
          owner_address: { _eq: $address }
          amount: { _gt: "0" }
        }
      ) {
        token_data_id
        amount
        property_version_v1
        current_token_data {
          collection_id
          token_name
          description
          token_uri
          token_properties
          current_collection {
            collection_name
            creator_address
            description
          }
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const holdings = data?.current_token_ownerships_v2 || [];
    if (import.meta.env?.DEV) {
      console.log(`🎨 Indexer returned ${holdings.length} NFT holdings`);
    }
    return holdings;
  } catch (error) {
    console.warn("Failed to fetch NFT holdings:", error);
    return [];
  }
};

/**
 * Get Yuzu liquidity positions by querying AddLiquidityEvents
 * Yuzu uses concentrated liquidity with position IDs, not fungible LP tokens
 * @param {string} address - User wallet address
 * @returns {Promise<Array>} Array of Yuzu LP positions
 */
export const getYuzuLiquidityPositions = async (address) => {
  let normalizedAddress = String(address).trim().toLowerCase();
  if (!normalizedAddress.startsWith("0x")) {
    normalizedAddress = `0x${normalizedAddress}`;
  }

  // Query for AddLiquidityEvents emitted to the user's address
  // Note: Yuzu stores position ownership via NFTs, so we check events for the actual user
  const query = `
    query GetYuzuEvents($address: String!) {
      events(
        where: {
          indexed_type: { _eq: "0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a::liquidity_pool::AddLiquidityEvent" }
          account_address: { _eq: $address }
        }
        order_by: { transaction_version: desc }
        limit: 50
      ) {
        transaction_version
        data
        account_address
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const events = data?.events || [];
    console.log(`🍋 Found ${events.length} Yuzu liquidity events for ${normalizedAddress}`);
    return events;
  } catch (error) {
    console.warn("Failed to fetch Yuzu positions:", error);
    return [];
  }
};
