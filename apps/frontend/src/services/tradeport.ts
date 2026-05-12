/**
 * Tradeport NFT Data Service
 * GraphQL API client for querying NFT floor prices and collection data
 */

const TRADEPORT_ENDPOINT = "https://api.indexer.xyz/graphql";

// These should ideally be in .env, but we'll use fallbacks or placeholders for now
const API_KEY = import.meta.env.VITE_TRADEPORT_API_KEY || "";
const API_USER = import.meta.env.VITE_TRADEPORT_API_USER || "";

/**
 * Execute a GraphQL query against Tradeport Indexer
 */
export const queryTradeport = async (query: string, variables: Record<string, any> = {}): Promise<any> => {
  if (!API_KEY || !API_USER) {
    console.warn("Tradeport API credentials missing. Please set VITE_TRADEPORT_API_KEY and VITE_TRADEPORT_API_USER.");
    return null;
  }

  try {
    const response = await fetch(TRADEPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "x-api-user": API_USER,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tradeport API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`Tradeport GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    console.error("queryTradeport error:", error);
    return null;
  }
};

/**
 * Get stats (floor, top bid) for a list of collection IDs
 */
export const getCollectionStats = async (collectionIds: string[]): Promise<Record<string, { floor: number; topBid: number }>> => {
  if (!collectionIds.length) return {};

  const query = `
    query getCollectionStats($ids: [String!]) {
      movement {
        collections(where: { collection_id: { _in: $ids } }) {
          collection_id
          floor
          top_bid
        }
      }
    }
  `;

  try {
    const data = await queryTradeport(query, { ids: collectionIds });
    
    let collections = data?.movement?.collections;
    if (!collections && data?.aptos) {
      collections = data.aptos.collections;
    }

    if (!collections) return {};

    const statsMap: Record<string, { floor: number; topBid: number }> = {};
    collections.forEach((col: any) => {
      if (col.collection_id) {
        statsMap[col.collection_id] = {
          floor: (col.floor || 0) / 100_000_000,
          topBid: (col.top_bid || 0) / 100_000_000
        };
      }
    });

    return statsMap;
  } catch (error) {
    console.error("getCollectionStats error:", error);
    return {};
  }
};
