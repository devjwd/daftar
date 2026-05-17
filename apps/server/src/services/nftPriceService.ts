import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';

const TRADEPORT_ENDPOINT = CONFIG.TRADEPORT.ENDPOINT || 'https://api.indexer.xyz/graphql';
const TRADEPORT_API_KEY = CONFIG.TRADEPORT.API_KEY;
const TRADEPORT_API_USER = CONFIG.TRADEPORT.API_USER;

const GET_ALL_COLLECTIONS_STATS = `
  query GetAllCollectionsStats {
    movement {
      collections(where: { floor: { _gt: 0 } }, limit: 500) {
        id
        slug
        title
        floor
        bids(order_by: { price: desc }, limit: 1) {
          price
        }
      }
    }
  }
`;

export async function updateNFTFloorPrices(supabase: SupabaseClient) {
  console.log('[NFTPriceService] 🔍 Fetching NFT floor prices from Tradeport...');

  if (!TRADEPORT_API_KEY) {
    console.error('[NFTPriceService] ❌ Missing TRADEPORT_API_KEY');
    return;
  }

  try {
    const response = await fetch(TRADEPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TRADEPORT_API_KEY,
        'x-api-user': TRADEPORT_API_USER || 'daftar'
      },
      body: JSON.stringify({
        query: GET_ALL_COLLECTIONS_STATS
      })
    });

    const json: any = await response.json();
    if (json.errors) {
      throw new Error(`Tradeport API error: ${JSON.stringify(json.errors)}`);
    }

    const collections = json.data?.movement?.collections || [];
    console.log(`[NFTPriceService] Found ${collections.length} collections on Movement.`);

    if (collections.length === 0) return;

    // Map to database format
    const stats = collections.map((c: any) => {
      const topBidOctas = c.bids?.[0]?.price || 0;
      return {
        collection_id: c.slug, // Using c.slug (which Tradeport populates as the hex address) for matching
        name: c.title,
        floor_price: Number(c.floor || 0) / 100_000_000, // Convert from Octas to MOVE
        top_bid: Number(topBidOctas) / 100_000_000, // Convert from Octas to MOVE
        updated_at: new Date().toISOString()
      };
    });

    // Upsert into database
    const { error } = await supabase
      .from('nft_collection_stats')
      .upsert(stats, { onConflict: 'collection_id' });

    if (error) {
      throw error;
    }

    console.log(`[NFTPriceService] ✅ Successfully updated ${stats.length} NFT collection stats.`);
  } catch (err: any) {
    console.error('[NFTPriceService] ❌ Error updating NFT prices:', err.message);
  }
}
