/**
 * Movement Network Indexer Service
 * GraphQL API client for querying Movement Network indexer
 * Documentation: https://docs.movementnetwork.xyz/devs/indexing
 */

import { DEFAULT_NETWORK } from "../config/network";
import { devLog } from "../utils/devLogger";
import { normalizeAddress } from '../utils/address';

/**
 * Get the appropriate indexer endpoint based on network
 */
export const getIndexerEndpoint = (): string => {
  return DEFAULT_NETWORK.indexer;
};

/**
 * Execute a GraphQL query against the Movement Indexer
 */
export const queryIndexer = async (query: string, variables: Record<string, any> = {}, signal?: AbortSignal): Promise<any> => {
  const endpoint = getIndexerEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
};

/**
 * Check if an account exists on chain (has any transactions or balances)
 */
export const checkAccountExists = async (address: string, signal?: AbortSignal): Promise<{exists: boolean, txCount: number}> => {
  const normalizedAddr = normalizeAddress(address);
  if (!normalizedAddr || normalizedAddr === "0x") {
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
    const data = await queryIndexer(query, { address: normalizedAddr }, signal);
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    return { exists: txCount > 0, txCount };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    devLog("checkAccountExists error:", error);
    return { exists: false, txCount: 0 };
  }
};

/**
 * Get user's token balances from indexer
 */
export const getUserTokenBalances = async (address: string): Promise<any[]> => {
  const normalizedAddr = normalizeAddress(address);
  
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
    const data = await queryIndexer(query, { address: normalizedAddr });
    return data?.current_fungible_asset_balances || [];
  } catch {
    return [];
  }
};

/**
 * Get token activity history for an address
 */
export const getTokenActivityHistory = async (address: string, limit: number = 50): Promise<any[]> => {
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
export const getLargeTokenTransfers = async (threshold: string = "1000000000", limit: number = 100): Promise<any[]> => {
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
 */
export const getWalletAge = async (address: string): Promise<{firstTxTimestamp: string|null, txCount: number}> => {
  const normalizedAddr = normalizeAddress(address);

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
    const data = await queryIndexer(query, { address: normalizedAddr });
    const firstTx = data?.account_transactions?.[0];
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    
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
    devLog("Failed to fetch wallet age:", error);
    return { firstTxTimestamp: null, txCount: 0 };
  }
};

/**
 * Get recent transaction history for portfolio chart
 */
export const getRecentTransactions = async (address: string, limit: number = 30): Promise<any[]> => {
  const normalizedAddr = normalizeAddress(address);

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
        transaction_version
        transaction_timestamp
        owner_address
        amount
        asset_type
        type
        is_transaction_success
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddr, limit });
    return data?.fungible_asset_activities || [];
  } catch (error) {
    devLog("Failed to fetch recent transactions:", error);
    return [];
  }
};

/**
 * Get user's NFT holdings (for LP position NFTs like Yuzu)
 */
export const getUserNFTHoldings = async (address: string): Promise<any[]> => {
  const normalizedAddr = normalizeAddress(address);

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
    const data = await queryIndexer(query, { address: normalizedAddr });
    const holdings = data?.current_token_ownerships_v2 || [];
    devLog(`🎨 Indexer returned ${holdings.length} NFT holdings`);
    return holdings;
  } catch (error) {
    devLog("Failed to fetch NFT holdings:", error);
    return [];
  }
};

/**
 * Get Yuzu liquidity positions by querying AddLiquidityEvents
 */
export const getYuzuLiquidityPositions = async (address: string): Promise<any[]> => {
  const normalizedAddr = normalizeAddress(address);

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
    const data = await queryIndexer(query, { address: normalizedAddr });
    const events = data?.events || [];
    devLog(`🍋 Found ${events.length} Yuzu liquidity events for ${normalizedAddr}`);
    return events;
  } catch (error) {
    devLog("Failed to fetch Yuzu positions:", error);
    return [];
  }
};
