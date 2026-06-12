/**
 * Tradeport NFT Data Service
 * GraphQL API client for querying NFT floor prices and collection data
 */

const TRADEPORT_ENDPOINT = "https://api.indexer.xyz/graphql";

// Direct client-side querying is deprecated.
// All NFT collection statistics are securely crawled and cached by the backend server.
const API_KEY = "";
const API_USER = "";

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


