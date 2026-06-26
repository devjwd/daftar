import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { fetchUserDeFiPositions } from './defiService.ts';
import fetch from 'node-fetch';
import CONFIG from '../config/index.ts';
import { INFLOW_ACTIONS, OUTFLOW_ACTIONS, LST_PRICE_ALIASES, NATIVE_MOVE_ADDRESSES, KNOWN_EXCHANGES } from '../config/whitelists.ts';

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
  walletAddress: string,
  force: boolean = false
) {
  const address = normalizeAddress(walletAddress);
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('wallet_address', address)
    .maybeSingle();
  const isPro = profile?.tier === 'PRO';

  const timestamp = new Date();
  if (isPro) {
    // Round to nearest 15 minutes for Pro users to give high-res long-term charts
    const minutes = timestamp.getMinutes();
    timestamp.setMinutes(minutes - (minutes % 15), 0, 0);
  } else {
    // Round to nearest hour for free users
    timestamp.setMinutes(0, 0, 0);
  }
  const timestampISO = timestamp.toISOString();

  if (!force) {
    const { data: existingSnapshot } = await supabase
      .from('user_networth_snapshots')
      .select('timestamp')
      .eq('user_address', address)
      .eq('timestamp', timestampISO)
      .maybeSingle();

    if (existingSnapshot) {
      console.log(`[Networth] Snapshot for ${address} already exists for this interval. Skipping calculation.`);
      return null;
    }
  }
  
  // 1. Fetch Current Prices
  const { data: prices } = await supabase.from('price_cache').select('token_id, price_usd');
  const priceMap: Record<string, number> = {};
  if (prices) {
    prices.forEach(p => priceMap[p.token_id] = Number(p.price_usd));
  }

  // 2. Calculate Wallet Balance USD
  // Get latest snapshot date first, then fetch only those records, avoiding loading all history
  const { data: latestDateRow } = await supabase
    .from('user_balance_snapshots')
    .select('snapshot_date')
    .eq('user_address', address)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestBalances: any[] = [];
  if (latestDateRow) {
    const { data: latestBalancesData } = await supabase
      .from('user_balance_snapshots')
      .select('*')
      .eq('user_address', address)
      .eq('snapshot_date', latestDateRow.snapshot_date);
    latestBalances = latestBalancesData || [];
  }
  
  let walletUsd = 0;
  latestBalances.forEach(b => {
    // Normalize MOVE address variants for price lookup
    const shortAsset = b.asset_type.toLowerCase().replace(/^0x0*/, '0x');
    const lookupKey = NATIVE_MOVE_ADDRESSES.has(shortAsset) ? '0x1' : b.asset_type;

    // Resolve price: direct match → LST alias → symbol-based fallback → 0
    let price = priceMap[lookupKey] || priceMap[shortAsset] || 0;
    
    if (price === 0 && b.symbol) {
      const upperSym = b.symbol.toUpperCase();
      if (LST_PRICE_ALIASES[b.symbol]) {
        price = priceMap[LST_PRICE_ALIASES[b.symbol]] || priceMap['0x1'] || 0;
      } else if (upperSym.includes('USDC') || upperSym.includes('USDT') || upperSym.includes('DAI') || upperSym.includes('USDE') || upperSym.includes('USD')) {
        price = 1.0;
      } else if (upperSym.includes('BTC')) {
        price = priceMap['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'] || 80000;
      } else if (upperSym.includes('ETH')) {
        price = priceMap['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'] || 2500;
      } else if (upperSym.includes('MOVE') || upperSym === 'APT' || shortAsset.includes('aptos_coin') || shortAsset === '0x1') {
        price = priceMap['0x1'] || priceMap['0xa'] || 0.05;
      }
    }
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

  // 5. Calculate Cumulative Net Inflows (Deposits - Withdrawals) incrementally
  let netDepositsUsd = 0;
  
  // Get the most recent snapshot before the current hour
  const { data: previousSnapshot } = await supabase
    .from('user_networth_snapshots')
    .select('net_deposits_usd, timestamp')
    .eq('user_address', address)
    .lt('timestamp', timestampISO)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousSnapshot) {
    netDepositsUsd = Number(previousSnapshot.net_deposits_usd || 0);
    // Fetch only transactions that occurred AFTER the previous snapshot
      const { data: newTxs } = await supabase
      .from('user_transaction_history')
      .select('value_usd, action, protocol')
      .eq('user_address', address)
      .gt('timestamp', previousSnapshot.timestamp)
      .in('action', [...INFLOW_ACTIONS, ...OUTFLOW_ACTIONS]);
      
    if (newTxs) {
      newTxs.forEach(tx => {
        const val = Number(tx.value_usd || 0);
        const action = tx.action as any;
        const protocol = tx.protocol || 'Unknown';
        const isExternal = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange') || protocol.includes('Bridge');
        
        if (isExternal) {
          if (INFLOW_ACTIONS.includes(action)) {
            netDepositsUsd += val;
          } else if (OUTFLOW_ACTIONS.includes(action)) {
            netDepositsUsd -= val;
          }
        }
      });
    }
  } else {
    // Fallback: full calculation if no previous snapshot exists
    const { data: allTxs } = await supabase
      .from('user_transaction_history')
      .select('value_usd, action, protocol')
      .eq('user_address', address)
      .in('action', [...INFLOW_ACTIONS, ...OUTFLOW_ACTIONS]);
      
    if (allTxs) {
      allTxs.forEach(tx => {
        const val = Number(tx.value_usd || 0);
        const action = tx.action as any;
        const protocol = tx.protocol || 'Unknown';
        const isExternal = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange') || protocol.includes('Bridge');
        
        if (isExternal) {
          if (INFLOW_ACTIONS.includes(action)) {
            netDepositsUsd += val;
          } else if (OUTFLOW_ACTIONS.includes(action)) {
            netDepositsUsd -= val;
          }
        }
      });
    }
  }

  const totalNetworthUsd = walletUsd + defiUsd + nftUsd;

  // 6. Save Snapshot
  const payload: any = {
    user_address: address,
    total_networth_usd: totalNetworthUsd,
    wallet_usd: walletUsd,
    defi_usd: defiUsd,
    nft_usd: nftUsd,
    net_deposits_usd: netDepositsUsd,
    timestamp: timestampISO,
    breakdown: { ...breakdown, is_realtime: true }
  };

  let { error } = await supabase.from('user_networth_snapshots').upsert(payload, { onConflict: 'user_address,timestamp' });

  if (error && error.message.includes('breakdown')) {
    console.warn(`[Networth] 'breakdown' column missing. Retrying upsert without 'breakdown' field.`);
    const fallbackPayload = { ...payload };
    delete fallbackPayload.breakdown;
    const retry = await supabase.from('user_networth_snapshots').upsert(fallbackPayload, { onConflict: 'user_address,timestamp' });
    error = retry.error;
  }

  if (error) {
    console.error(`[Networth] Failed to save snapshot for ${address}:`, error.message);
  } else {
    console.log(`[Networth] ✅ Snapshot saved for ${address}: $${totalNetworthUsd.toFixed(2)}`);
    
    // Prune hourly snapshots — keep 90 days to support all chart timeframes (1W, 1M, 3M)
    try {
      await supabase.rpc('prune_old_snapshots', { user_addr: address, days_to_keep: 90 });
    } catch (pruneErr: any) {
      console.warn(`[Networth] Failed to prune old snapshots for ${address}:`, pruneErr.message);
    }
  }

  return { totalNetworthUsd, walletUsd, defiUsd, nftUsd, netDepositsUsd };
}

/**
 * Baseline PNL initialization
 */
export async function setPNLBaseline(supabase: SupabaseClient, walletAddress: string) {
  const address = normalizeAddress(walletAddress);
  const snapshot = await takeNetworthSnapshot(supabase, address, true);
  if (!snapshot) throw new Error('Failed to take networth snapshot');
  
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
