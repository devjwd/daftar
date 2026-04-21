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
        .from('dapp_swap_stats')
        .select('total_swaps, total_volume_usd')
        .eq('wallet_address', normalizedAddress)
        .maybeSingle();
      
      if (swapStats) {
        swapCount = Number(swapStats.total_swaps || 0);
        swapVolume = Number(swapStats.total_volume_usd || 0);
      }
    }
    
    // 4. Calculate Wallet Age (Days On-chain)
    const firstTxVersion = indexerData?.first_tx?.[0]?.transaction_version;
    let daysOnchain = 0;
 
    if (firstTxVersion !== undefined && firstTxVersion !== null) {
      try {
        const tsQuery = `
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
        const tsData = await queryIndexer(tsQuery, { version: firstTxVersion });
        const firstTxTimestamp = tsData?.block_metadata_transactions?.[0]?.timestamp;
 
        if (firstTxTimestamp) {
          const firstMs = Number(firstTxTimestamp) / 1000; // Indexer gives microseconds
          const nowMs = Date.now();
          daysOnchain = Math.floor((nowMs - firstMs) / (1000 * 60 * 60 * 24));
        }
      } catch (err) {
        console.warn('[DataCoordination] Failed to fetch first tx timestamp:', err);
      }
    }
 
    return {
      address: normalizedAddress,
      txCount: indexerData?.account_transactions_aggregate?.aggregate?.count || 0,
      firstTxVersion: firstTxVersion || null,
      daysOnchain: Math.max(0, daysOnchain),
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
