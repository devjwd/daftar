import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';

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
      
      // Handle Incoming Assets (user received tokens)
      if (tx.asset_in_symbol && tx.asset_in_amount > 0) {
        const rawActivities = [
          ...(tx.metadata?.fungible_asset_activities || []),
          ...(tx.metadata?.coin_activities || [])
        ];
        const matched = rawActivities.find((a: any) => {
          const sym = a.metadata?.symbol || a.symbol || '';
          return sym.toLowerCase() === tx.asset_in_symbol.toLowerCase();
        });
        const assetType = matched?.asset_type || matched?.coin_type || tx.asset_in_symbol;

        if (!balances[assetType]) balances[assetType] = { amount: 0, symbol: tx.asset_in_symbol };
        
        // Inflows: tokens received by the user
        if (['RECEIVE', 'CLAIM', 'UNSTAKE', 'SWAP', 'BORROW', 'BRIDGE_IN', 'WITHDRAW'].includes(action)) {
          balances[assetType].amount += Number(tx.asset_in_amount);
        }
      }

      // Handle Outgoing Assets (user spent/locked tokens)
      if (tx.asset_out_symbol && tx.asset_out_amount > 0) {
        const rawActivities = [
          ...(tx.metadata?.fungible_asset_activities || []),
          ...(tx.metadata?.coin_activities || [])
        ];
        const matched = rawActivities.find((a: any) => {
          const sym = a.metadata?.symbol || a.symbol || '';
          return sym.toLowerCase() === tx.asset_out_symbol.toLowerCase();
        });
        const assetType = matched?.asset_type || matched?.coin_type || tx.asset_out_symbol;

        if (!balances[assetType]) balances[assetType] = { amount: 0, symbol: tx.asset_out_symbol };
        
        // Outflows: tokens spent or locked by the user
        if (['SEND', 'DEPOSIT', 'STAKE', 'SWAP', 'LEND', 'REPAY', 'BRIDGE_OUT'].includes(action)) {
          balances[assetType].amount -= Number(tx.asset_out_amount);
        }
      }

      currentTxIndex++;
    }

    // 4. Capture snapshot of all non-zero balances at the end of this day
    for (const [assetType, data] of Object.entries(balances)) {
      if (Math.abs(data.amount) > 0.00000001) { // Filter out dust
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

  console.log(`[Portfolio] ✅ Reconstruction complete for ${address}.`);
  return { snapshotsCount: snapshots.length };
}
