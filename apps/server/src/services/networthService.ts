import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { fetchUserDeFiPositions } from './defiService.ts';
import fetch from 'node-fetch';
import CONFIG from '../config/index.ts';

/**
 * Fetch user holdings directly from the Movement network indexer
 */
async function fetchUserNFTHoldings(address: string): Promise<any[]> {
  try {
    const response = await fetch(CONFIG.MOVEMENT.INDEXER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query GetUserNFTs($address: String!) {
            current_token_ownerships_v2(
              where: {
                owner_address: { _eq: $address }
                amount: { _gt: "0" }
              }
            ) {
              amount
              current_token_data {
                collection_id
              }
            }
          }
        `,
        variables: { address },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const json: any = await response.json();
    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }

    return json.data?.current_token_ownerships_v2 || [];
  } catch (err: any) {
    console.error('[NetworthService] ❌ Failed to fetch user NFT holdings:', err.message);
    return [];
  }
}

/**
 * Net Worth Snapshot Service
 * Aggregates Wallet + DeFi + NFT value every hour
 */

export async function takeNetworthSnapshot(
  supabase: SupabaseClient,
  walletAddress: string
) {
  const address = normalizeAddress(walletAddress);
  
  // 1. Fetch Current Prices
  const { data: prices } = await supabase.from('price_cache').select('token_id, price_usd');
  const priceMap: Record<string, number> = {};
  if (prices) {
    prices.forEach(p => priceMap[p.token_id] = Number(p.price_usd));
  }

  // 2. Calculate Wallet Balance USD
  // We use the latest snapshots + any txs since then, or just query latest balances
  const { data: snapshots } = await supabase
    .from('user_balance_snapshots')
    .select('*')
    .eq('user_address', address)
    .order('snapshot_date', { ascending: false });

  // Filter for the latest date only
  const latestDate = snapshots?.[0]?.snapshot_date;
  const latestBalances = snapshots?.filter(s => s.snapshot_date === latestDate) || [];
  
  let walletUsd = 0;
  latestBalances.forEach(b => {
    const price = priceMap[b.asset_type] || priceMap['0x1'] || 0;
    walletUsd += Number(b.amount) * price;
  });

  // 3. Calculate DeFi/LP Positions
  const defiPositions = await fetchUserDeFiPositions(supabase, address, priceMap);
  const defiUsd = defiPositions.reduce((sum, p) => sum + p.usdValue, 0);
  
  // Create protocol breakdown map
  const breakdown: Record<string, number> = {};
  defiPositions.forEach(p => {
    breakdown[p.protocol] = (breakdown[p.protocol] || 0) + p.usdValue;
  });

  // 4. Calculate NFT Valuation
  const { data: nftStats } = await supabase.from('nft_collection_stats').select('*');
  const statsMap: Record<string, number> = {};
  if (nftStats) {
    nftStats.forEach(stat => {
      statsMap[stat.collection_id] = Number(stat.top_bid || 0);
    });
  }

  const holdings = await fetchUserNFTHoldings(address);
  const movePrice = priceMap['0x1'] || priceMap['MOVE'] || 0;
  let nftUsd = 0;

  holdings.forEach(h => {
    const colId = h.current_token_data?.collection_id;
    if (colId && statsMap[colId]) {
      const bid = statsMap[colId];
      const amount = parseFloat(h.amount) || 1;
      nftUsd += bid * amount * movePrice;
    }
  });

  // 5. Calculate Cumulative Net Inflows (Deposits - Withdrawals)
  const { data: txs } = await supabase
    .from('user_transaction_history')
    .select('value_usd, action')
    .eq('user_address', address);
    
  let netDepositsUsd = 0;
  if (txs) {
    txs.forEach(tx => {
      const val = Number(tx.value_usd || 0);
      const action = tx.action || '';
      // Only count external flows (money entering/leaving the ecosystem)
      if (['RECEIVE', 'BRIDGE_IN'].includes(action)) {
        netDepositsUsd += val;
      } else if (['SEND', 'BRIDGE_OUT'].includes(action)) {
        netDepositsUsd -= val;
      }
    });
  }

  const totalNetworthUsd = walletUsd + defiUsd + nftUsd;
  const timestamp = new Date();
  // Round to nearest hour for the UNIQUE constraint
  timestamp.setMinutes(0, 0, 0);

  // 6. Save Snapshot
  const { error } = await supabase.from('user_networth_snapshots').upsert({
    user_address: address,
    total_networth_usd: totalNetworthUsd,
    wallet_usd: walletUsd,
    defi_usd: defiUsd,
    nft_usd: nftUsd,
    net_deposits_usd: netDepositsUsd,
    breakdown: breakdown,
    timestamp: timestamp.toISOString()
  }, { onConflict: 'user_address,timestamp' });

  if (error) {
    console.error(`[Networth] Failed to save snapshot for ${address}:`, error.message);
  } else {
    console.log(`[Networth] ✅ Snapshot saved for ${address}: $${totalNetworthUsd.toFixed(2)}`);
  }

  return { totalNetworthUsd, walletUsd, defiUsd, nftUsd, netDepositsUsd };
}

/**
 * Baseline PNL initialization
 */
export async function setPNLBaseline(supabase: SupabaseClient, walletAddress: string) {
  const address = normalizeAddress(walletAddress);
  const snapshot = await takeNetworthSnapshot(supabase, address);
  
  const { error } = await supabase
    .from('profiles')
    .update({
      pnl_baseline_at: new Date().toISOString(),
      pnl_baseline_value: snapshot.totalNetworthUsd
    })
    .eq('wallet_address', address);
    
  if (error) throw error;
  return snapshot;
}
