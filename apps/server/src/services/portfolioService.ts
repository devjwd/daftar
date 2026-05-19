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
        
        // Skip if it's just the gas fee deduction (already handled)
        const assetType = act.asset_type || act.coin_type || '';
        if ((assetType.includes('aptos_coin') || assetType === '0x1') && Math.abs(amount - gasInMove) < 0.00005) {
          continue;
        }

        const symbol = act.metadata?.symbol || (assetType.includes('aptos_coin') ? 'MOVE' : 'Token');

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

  console.log(`[Portfolio] ✅ Reconstruction complete for ${address}.`);
  return { snapshotsCount: snapshots.length };
}
