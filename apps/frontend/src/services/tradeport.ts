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
 * Get floor prices for a list of collection IDs
 */
export const getCollectionFloorPrices = async (collectionIds: string[]): Promise<Record<string, number>> => {
  if (!collectionIds.length) return {};

  const query = `
    query getCollectionFloors($ids: [String!]) {
      movement {
        collections(where: { collection_id: { _in: $ids } }) {
          collection_id
          floor
        }
      }
    }
  `;

  // Note: If 'movement' isn't supported, we might need to fallback to 'aptos'
  // But since the docs mentioned Movement, we'll try that first.
  try {
    const data = await queryTradeport(query, { ids: collectionIds });
    
    // Fallback to aptos if movement field is null
    let collections = data?.movement?.collections;
    if (!collections && data?.aptos) {
      collections = data.aptos.collections;
    }

    if (!collections) return {};

    const floorMap: Record<string, number> = {};
    collections.forEach((col: any) => {
      if (col.collection_id && col.floor !== undefined) {
        // Floor is usually in native token units (octas for Aptos/Movement)
        // We'll return it as a float in MOVE
        floorMap[col.collection_id] = col.floor / 100_000_000;
      }
    });

    return floorMap;
  } catch (error) {
    console.error("getCollectionFloorPrices error:", error);
    return {};
  }
};
