import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { INFLOW_ACTIONS, OUTFLOW_ACTIONS, isJunkAsset, APTOS_COIN_PATTERNS, NATIVE_MOVE_ADDRESSES, LST_PRICE_ALIASES, KNOWN_EXCHANGES } from '../config/whitelists.ts';

/**
 * Portfolio Reconstruction Service
 * Generates historical balance snapshots from transaction history
 */

interface BalanceState {
  [assetType: string]: {
    amount: number;
    symbol: string;
  };
}

/**
 * Reconstructs daily balance snapshots for a wallet
 */
export async function reconstructHistoricalBalances(
  supabase: SupabaseClient,
  walletAddress: string
) {
  const address = normalizeAddress(walletAddress);
  console.log(`[Portfolio] 🛠️ Reconstructing history for ${address}...`);

  // 1. Fetch the latest snapshot date to enable incremental reconstruction
  const { data: latestSnapshot, error: snapError } = await supabase
    .from('user_balance_snapshots')
    .select('snapshot_date')
    .eq('user_address', address)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError && snapError.code !== 'PGRST116') {
    console.error(`[Portfolio] Error fetching latest snapshot:`, snapError);
  }

  let lastDateStr = latestSnapshot?.snapshot_date;
  const balances: BalanceState = {};
  let recalcStartDateStr: string | null = null;
  let balanceLoadDateStr: string | null = null;

  if (lastDateStr) {
    // Shift recalcStartDate back by 1 day to catch retroactive and same-day transactions
    const recalcDate = new Date(lastDateStr);
    recalcDate.setDate(recalcDate.getDate() - 1);
    recalcStartDateStr = recalcDate.toISOString().split('T')[0];

    // Load balances from the day strictly before the recalculation start date (2 days before lastDateStr)
    const balanceLoadDate = new Date(lastDateStr);
    balanceLoadDate.setDate(balanceLoadDate.getDate() - 2);
    balanceLoadDateStr = balanceLoadDate.toISOString().split('T')[0];
  }

  // 2. Load existing balances if we have a previous snapshot date
  if (balanceLoadDateStr) {
    const { data: existingBalances } = await supabase
      .from('user_balance_snapshots')
      .select('*')
      .eq('user_address', address)
      .eq('snapshot_date', balanceLoadDateStr);

    if (existingBalances && existingBalances.length > 0) {
      existingBalances.forEach(b => {
        balances[b.asset_type] = { amount: Number(b.amount), symbol: b.symbol };
      });
    }
  }

  // 3. Fetch transactions (incremental starting from recalcStartDateStr)
  let txQuery = supabase
    .from('user_transaction_history')
    .select('*')
    .eq('user_address', address)
    .order('timestamp', { ascending: true });

  if (recalcStartDateStr) {
    txQuery = txQuery.gte('timestamp', `${recalcStartDateStr}T00:00:00.000Z`);
  }

  // Handle potential 1k limit by paginating transaction fetch
  let txs: any[] = [];
  let hasMore = true;
  let page = 0;
  const PAGE_SIZE = 1000;
  
  while (hasMore) {
    const { data, error: txError } = await txQuery.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (txError) throw txError;
    
    if (data && data.length > 0) {
      txs = txs.concat(data);
      page++;
      if (data.length < PAGE_SIZE) hasMore = false;
    } else {
      hasMore = false;
    }
  }

  if (txs.length === 0) {
    console.log(`[Portfolio] No new transactions found for ${address} since ${lastDateStr || 'beginning'}.`);
    // If there are no new transactions but we have previous balances, we should carry them forward to today
    if (!lastDateStr) return { snapshotsCount: 0 };
  }

  const snapshots: any[] = [];
  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let currentDate: Date;
  if (txs.length > 0) {
    const firstNewTxDate = new Date(txs[0].timestamp);
    const candidateStartDate = new Date(firstNewTxDate.getFullYear(), firstNewTxDate.getMonth(), firstNewTxDate.getDate());
    
    if (recalcStartDateStr) {
      const recalcStart = new Date(recalcStartDateStr);
      currentDate = recalcStart > candidateStartDate ? recalcStart : candidateStartDate;
    } else {
      currentDate = candidateStartDate;
    }
  } else {
     // No new txs, just carry forward balances from day after balanceLoadDateStr to today
     if (balanceLoadDateStr) {
       currentDate = new Date(balanceLoadDateStr);
       currentDate.setDate(currentDate.getDate() + 1);
     } else {
       currentDate = new Date();
     }
  }

  let currentTxIndex = 0;

  // 4. Iterate day by day
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Process all transactions that happened on this specific day
    while (
      currentTxIndex < txs.length && 
      new Date(txs[currentTxIndex].timestamp) < nextDay
    ) {
      const tx = txs[currentTxIndex];
      const action = tx.action || '';
      
      // Process all activities to capture multi-asset flows (LPs, multi-hop swaps)
      const rawActivities = [
        ...(tx.metadata?.fungible_asset_activities || []),
        ...(tx.metadata?.coin_activities || [])
      ];

      // Deduct Gas Fee (Always in MOVE/APT '0x1')
      const gasUsed = Number(tx.metadata?.gas_used || 0);
      const gasPrice = Number(tx.metadata?.gas_unit_price || 0);
      const gasInMove = (gasUsed * gasPrice) / 1e8;
      if (gasInMove > 0) {
        if (!balances['0x1']) balances['0x1'] = { amount: 0, symbol: 'MOVE' };
        balances['0x1'].amount -= gasInMove;
      }

      for (const act of rawActivities) {
        const type = String(act.type || act.activity_type || '').toLowerCase();
        const owner = String(act.owner_address || act.owner || '').toLowerCase();
        const isUser = owner === address.toLowerCase();
        
        let direction: 'in' | 'out' | null = null;
        if (type.includes('deposit') || type.includes('received') || type.includes('credit') || type.includes('mint')) {
          direction = isUser ? 'in' : null;
        } else if (type.includes('withdraw') || type.includes('sent') || type.includes('debit') || type.includes('burn')) {
          direction = isUser ? 'out' : null;
        } else if (type.includes('transfer')) {
          direction = isUser ? (type.includes('withdraw') ? 'out' : 'in') : null;
        }

        if (!direction) continue;

        const decimals = act.metadata?.decimals || 8;
        const amount = Math.abs(Number(act.amount || 0)) / Math.pow(10, decimals);
        
        const rawAssetType = act.asset_type || act.coin_type || '';

        // Normalize raw AptosCoin type → 0x1 (native MOVE on Movement Network)
        // Also normalize 0xa and full-padded 0x0...0a addresses to 0x1 to prevent duplicates
        let assetType = rawAssetType;
        if (APTOS_COIN_PATTERNS.some(p => rawAssetType.includes(p))) {
          assetType = '0x1';
        } else {
          const shortForm = rawAssetType.toLowerCase().replace(/^0x0*/, '0x');
          if (NATIVE_MOVE_ADDRESSES.has(shortForm) || NATIVE_MOVE_ADDRESSES.has(rawAssetType)) {
            assetType = '0x1';
          }
        }

        // Skip if it's just the gas fee deduction (already handled)
        if (assetType === '0x1' && Math.abs(amount - gasInMove) < 0.00005) {
          continue;
        }

        const symbol = act.metadata?.symbol || (assetType === '0x1' ? 'MOVE' : 'Token');

        // Skip scam tokens, airdrop tokens, LP tokens, and raw Aptos types
        if (isJunkAsset(assetType, symbol)) continue;

        if (!balances[assetType]) balances[assetType] = { amount: 0, symbol };
        
        if (direction === 'in') {
          balances[assetType].amount += amount;
        } else if (direction === 'out') {
          balances[assetType].amount -= amount;
        }
      }

      currentTxIndex++;
    }

    // 4. Capture snapshot of all non-zero balances at the end of this day
    for (const [assetType, data] of Object.entries(balances)) {
      data.amount = Math.max(0, data.amount); // Enforce zero floor
      // Second safety gate: skip junk assets that may have crept in via initial balance load
      if (isJunkAsset(assetType, data.symbol)) continue;
      if (data.amount > 0.00000001) { // Filter out dust
        snapshots.push({
          user_address: address,
          asset_type: assetType,
          symbol: data.symbol,
          amount: data.amount,
          snapshot_date: dateStr
        });
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 5. Batch Save Snapshots to Database
  console.log(`[Portfolio] Saving ${snapshots.length} daily snapshots for ${address}...`);
  
  // Use upsert to allow re-running the reconstruction without duplicates
  const BATCH_SIZE = 500;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('user_balance_snapshots')
      .upsert(batch, { onConflict: 'user_address,asset_type,snapshot_date' });
      
    if (upsertError) {
      console.error(`[Portfolio] Error saving batch:`, upsertError);
    }
  }

  // 6. Trigger backfilling of historical net worth snapshots
  try {
    await backfillHistoricalNetworth(supabase, address);
  } catch (err: any) {
    console.error(`[Portfolio] Failed to backfill historical net worth:`, err.message);
  }

  console.log(`[Portfolio] ✅ Reconstruction complete for ${address}.`);
  return { snapshotsCount: snapshots.length };
}

/**
 * Backfills user_networth_snapshots using daily user_balance_snapshots and historical token prices.
 */
export async function backfillHistoricalNetworth(supabase: SupabaseClient, walletAddress: string) {
  const address = normalizeAddress(walletAddress);
  console.log(`[Portfolio] 📈 Backfilling historical net worth snapshots for ${address}...`);

  // 1. Fetch all balance snapshots (paginated)
  let balSnaps: any[] = [];
  let hasMoreSnaps = true;
  let snapPage = 0;
  const SNAP_PAGE_SIZE = 1000;

  while (hasMoreSnaps) {
    const { data: pageSnaps, error: balErr } = await supabase
      .from('user_balance_snapshots')
      .select('*')
      .eq('user_address', address)
      .order('snapshot_date', { ascending: true })
      .range(snapPage * SNAP_PAGE_SIZE, (snapPage + 1) * SNAP_PAGE_SIZE - 1);

    if (balErr) {
      console.error(`[Portfolio] Error fetching balance snapshots page:`, balErr);
      return;
    }

    if (pageSnaps && pageSnaps.length > 0) {
      balSnaps = balSnaps.concat(pageSnaps);
      snapPage++;
      if (pageSnaps.length < SNAP_PAGE_SIZE) {
        hasMoreSnaps = false;
      }
    } else {
      hasMoreSnaps = false;
    }
  }

  if (balSnaps.length === 0) {
    console.log(`[Portfolio] No balance snapshots found for ${address}. Cannot backfill net worth.`);
    return;
  }

  // Group balance snapshots by date
  const snapsByDate: Record<string, typeof balSnaps> = {};
  balSnaps.forEach(snap => {
    const date = snap.snapshot_date;
    if (!snapsByDate[date]) snapsByDate[date] = [];
    snapsByDate[date].push(snap);
  });

  const uniqueDates = Object.keys(snapsByDate).sort();
  const assetTypes = Array.from(new Set(balSnaps.map(snap => snap.asset_type)));

  // Add short forms of any addresses in assetTypes to ensure we fetch their prices too
  const queryAssetTypes = [...assetTypes];
  assetTypes.forEach(addr => {
    const short = addr.toLowerCase().replace(/^0x0*/, '0x');
    if (!queryAssetTypes.includes(short)) {
      queryAssetTypes.push(short);
    }
  });

  // 2. Fetch all transaction history to compute daily cumulative net deposits (paginated)
  let txs: any[] = [];
  let hasMoreTxs = true;
  let txPage = 0;
  const TX_PAGE_SIZE = 1000;

  while (hasMoreTxs) {
    const { data: pageTxs, error: txErr } = await supabase
      .from('user_transaction_history')
      .select('timestamp, action, value_usd, protocol')
      .eq('user_address', address)
      .order('timestamp', { ascending: true })
      .range(txPage * TX_PAGE_SIZE, (txPage + 1) * TX_PAGE_SIZE - 1);

    if (txErr) {
      console.error(`[Portfolio] Error fetching txs for net deposits page:`, txErr);
      return;
    }

    if (pageTxs && pageTxs.length > 0) {
      txs = txs.concat(pageTxs);
      txPage++;
      if (pageTxs.length < TX_PAGE_SIZE) {
        hasMoreTxs = false;
      }
    } else {
      hasMoreTxs = false;
    }
  }

  // 3. Fetch all price cache as a fallback for current prices
  const { data: cachedPrices } = await supabase.from('price_cache').select('token_id, price_usd');
  const fallbackPrices: Record<string, number> = {};
  if (cachedPrices) {
    cachedPrices.forEach(p => {
      const token = p.token_id.toLowerCase().replace(/^0x0*/, '0x');
      fallbackPrices[token] = Number(p.price_usd);
    });
  }

  // For historical prices, query token_price_history for these assets (paginated to bypass Supabase 1000 limit)
  let histPrices: any[] = [];
  let hasMorePrices = true;
  let pricePage = 0;
  const PRICE_PAGE_SIZE = 1000;

  while (hasMorePrices) {
    const { data: pagePrices, error: priceErr } = await supabase
      .from('token_price_history')
      .select('token_address, price, timestamp')
      .in('token_address', queryAssetTypes)
      .range(pricePage * PRICE_PAGE_SIZE, (pricePage + 1) * PRICE_PAGE_SIZE - 1);

    if (priceErr) {
      console.error(`[Portfolio] Error fetching price history page:`, priceErr);
      return;
    }

    if (pagePrices && pagePrices.length > 0) {
      histPrices = histPrices.concat(pagePrices);
      pricePage++;
      if (pagePrices.length < PRICE_PAGE_SIZE) {
        hasMorePrices = false;
      }
    } else {
      hasMorePrices = false;
    }
  }

  // Map: token_address -> date -> price
  const priceHistoryMap: Record<string, Record<string, number>> = {};
  if (histPrices) {
    histPrices.forEach(hp => {
      const token = hp.token_address.toLowerCase().replace(/^0x0*/, '0x');
      const date = new Date(hp.timestamp).toISOString().split('T')[0];
      if (!priceHistoryMap[token]) priceHistoryMap[token] = {};
      priceHistoryMap[token][date] = Number(hp.price);
    });
  }

  // Helper to resolve price on a specific date
  const getPriceOnDate = (token: string, date: string, symbol?: string): number => {
    let normToken = token.toLowerCase().replace(/^0x0*/, '0x');

    // Normalize all native MOVE addresses to 0x1
    if (NATIVE_MOVE_ADDRESSES.has(normToken)) {
      normToken = '0x1';
    }

    if (priceHistoryMap[normToken]?.[date]) {
      return priceHistoryMap[normToken][date];
    }
    const targetDate = new Date(date);
    for (let i = 1; i <= 3; i++) {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - i);
      const prevDateStr = prevDate.toISOString().split('T')[0];
      if (priceHistoryMap[normToken]?.[prevDateStr]) {
        return priceHistoryMap[normToken][prevDateStr];
      }
    }
    if (fallbackPrices[normToken]) return fallbackPrices[normToken];

    // LST price resolution: gMOVE/stMOVE/cvMOVE inherit their underlying token's price
    if (symbol && LST_PRICE_ALIASES[symbol]) {
      const underlyingToken = LST_PRICE_ALIASES[symbol];
      return getPriceOnDate(underlyingToken, date);
    }

    if (normToken.includes('aptos_coin') || normToken === '0x1') {
      return fallbackPrices['0x1'] || fallbackPrices['0xa'] || 0.05;
    }
    return 0;
  };

  // 4. Calculate daily cumulative net deposits
  const dailyNetDeposits: Record<string, number> = {};
  let runningNetDeposits = 0;
  let txIndex = 0;

  // Map each unique date to its cumulative net deposits at the end of that day
  uniqueDates.forEach(dateStr => {
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    while (txIndex < (txs?.length || 0) && new Date(txs![txIndex].timestamp) <= endOfDay) {
      const tx = txs![txIndex];
      const action = tx.action || '';
      const val = Number(tx.value_usd || 0);
      const protocol = tx.protocol || 'Unknown';
      const isExchange = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange');

      if (isExchange) {
        if (INFLOW_ACTIONS.includes(action as any)) {
          runningNetDeposits += val;
        } else if (OUTFLOW_ACTIONS.includes(action as any)) {
          runningNetDeposits -= val;
        }
      }
      txIndex++;
    }
    dailyNetDeposits[dateStr] = runningNetDeposits;
  });

  // 4b. Find the oldest real-time snapshot for the user (to avoid backfilling over it)
  const { data: allUserSnaps } = await supabase
    .from('user_networth_snapshots')
    .select('timestamp, defi_usd, nft_usd, breakdown')
    .eq('user_address', address)
    .order('timestamp', { ascending: true });

  let firstRealTimestamp: string | null = null;
  if (allUserSnaps) {
    for (const snap of allUserSnaps) {
      const isRealtime = snap.breakdown?.is_realtime === true;
      const isBackfilled = snap.breakdown?.is_backfilled === true;
      
      const isLegacyRealtime = !isBackfilled && (
        Number(snap.defi_usd || 0) > 0 ||
        Number(snap.nft_usd || 0) > 0 ||
        !snap.timestamp.includes('T23:00:00')
      );

      if (isRealtime || isLegacyRealtime) {
        firstRealTimestamp = snap.timestamp;
        break;
      }
    }
  }

  let firstRealDateStr: string | null = null;
  if (firstRealTimestamp) {
    firstRealDateStr = firstRealTimestamp.split('T')[0];
    console.log(`[Portfolio] ℹ️ Found earliest real-time snapshot for ${address} on ${firstRealDateStr}. Will only backfill dates before this.`);
  }

  // 4c. Delete existing backfilled snapshots (both new format and legacy format)
  await supabase
    .from('user_networth_snapshots')
    .delete()
    .eq('user_address', address)
    .filter('breakdown->>is_backfilled', 'eq', 'true');

  await supabase
    .from('user_networth_snapshots')
    .delete()
    .eq('user_address', address)
    .eq('defi_usd', 0)
    .eq('nft_usd', 0)
    .like('timestamp', '%T23:00:00%');

  // 5. Construct user_networth_snapshots records
  const networthSnapshots: any[] = [];
  uniqueDates.forEach(dateStr => {
    // If there is a real-time snapshot date, only write backfilled snapshots for dates strictly BEFORE that day
    if (firstRealDateStr && dateStr >= firstRealDateStr) {
      return;
    }

    const daySnaps = snapsByDate[dateStr];
    let walletUsd = 0;
    
    daySnaps.forEach(snap => {
      const price = getPriceOnDate(snap.asset_type, dateStr, snap.symbol);
      walletUsd += Number(snap.amount) * price;
    });

    const netDepositsUsd = dailyNetDeposits[dateStr] || 0;
    const timestampISO = `${dateStr}T23:00:00.000Z`;

    networthSnapshots.push({
      user_address: address,
      total_networth_usd: walletUsd,
      wallet_usd: walletUsd,
      defi_usd: 0,
      nft_usd: 0,
      net_deposits_usd: netDepositsUsd,
      timestamp: timestampISO,
      breakdown: { is_backfilled: true }
    });
  });

  // 6. Batch Upsert Snapshots
  if (networthSnapshots.length > 0) {
    console.log(`[Portfolio] Saving ${networthSnapshots.length} historical networth snapshots for ${address}...`);
    const BATCH_SIZE = 500;
    for (let i = 0; i < networthSnapshots.length; i += BATCH_SIZE) {
      const batch = networthSnapshots.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await supabase
        .from('user_networth_snapshots')
        .upsert(batch, { onConflict: 'user_address,timestamp' });

      if (upsertError) {
        console.error(`[Portfolio] Failed to save historical networth snapshot batch:`, upsertError.message);
      }
    }
  } else {
    console.log(`[Portfolio] No historical snapshots to save before first real-time snapshot for ${address}.`);
  }

  console.log(`[Portfolio] ✅ Completed backfilling historical networth for ${address}.`);
}
