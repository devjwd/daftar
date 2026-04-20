import { queryIndexer } from '../indexer.js';
import { getProfileAsync } from '../profileService.js';
import { supabase } from '../../config/supabase.js';

export async function fetchCoreEligibilityStats(address) {
  if (!address) return null;

  const normalizedAddress = address.toLowerCase();

  const query = `
    query GetEligibilityStats($address: String!) {
      account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
        aggregate {
          count
        }
      }
      
      first_tx: account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: asc }
        limit: 1
      ) {
        transaction_version
      }

      current_fungible_asset_balances(
        where: { owner_address: { _eq: $address }, amount: { _gt: "0" } }
      ) {
        asset_type
        amount
        metadata {
          decimals
          symbol
          name
        }
      }

      current_token_ownerships_v2(
        where: { owner_address: { _eq: $address }, amount: { _gt: "0" } }
        limit: 100
      ) {
        token_data_id
        current_token_data {
          collection_id
          token_name
        }
      }
    }
  `;

  try {
    // 1. Fetch Indexer Data
    const indexerData = await queryIndexer(query, { address: normalizedAddress });
    
    // 2. Fetch Profile Data (Simulated/Async)
    const profile = await getProfileAsync(normalizedAddress);

    // 3. Fetch Swap Records (Count/Volume) from DB
    let swapCount = 0;
    let swapVolume = 0;
    if (supabase) {
      const { data: swapStats } = await supabase
        .from('swap_records')
        .select('amount_in_usd')
        .eq('wallet_address', normalizedAddress);
      
      if (swapStats) {
        swapCount = swapStats.length;
        swapVolume = swapStats.reduce((acc, curr) => acc + (Number(curr.amount_in_usd) || 0), 0);
      }
    }
    
    return {
      address: normalizedAddress,
      txCount: indexerData?.account_transactions_aggregate?.aggregate?.count || 0,
      firstTxVersion: indexerData?.first_tx?.[0]?.transaction_version || null,
      balances: indexerData?.current_fungible_asset_balances || [],
      nfts: indexerData?.current_token_ownerships_v2 || [],
      // Daftar Specific
      profile: profile || null,
      swapCount,
      swapVolume,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('[DataCoordination] Batch fetch failed:', error);
    throw error;
  }
}
