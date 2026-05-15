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

  // 1. Fetch all processed transactions for this user (Chronological)
  const { data: txs, error: txError } = await supabase
    .from('user_transaction_history')
    .select('*')
    .eq('user_address', address)
    .order('timestamp', { ascending: true });

  if (txError) throw txError;
  if (!txs || txs.length === 0) {
    console.log(`[Portfolio] No transactions found for ${address}.`);
    return;
  }

  const balances: BalanceState = {};
  const snapshots: any[] = [];
  
  // 2. Identify the date range
  const firstTxDate = new Date(txs[0].timestamp);
  const today = new Date();
  
  // Set time to midnight for consistent daily snapshots
  const startDate = new Date(firstTxDate.getFullYear(), firstTxDate.getMonth(), firstTxDate.getDate());
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let currentTxIndex = 0;
  let currentDate = new Date(startDate);

  // 3. Iterate day by day from the first transaction to today
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
      
      // Handle Incoming Assets
      if (tx.asset_in_symbol && tx.asset_in_amount > 0) {
        // Try to get asset_type from metadata if possible, fallback to symbol
        const assetType = tx.metadata?.fungible_asset_activities?.[0]?.asset_type || tx.asset_in_symbol;
        if (!balances[assetType]) balances[assetType] = { amount: 0, symbol: tx.asset_in_symbol };
        
        // Logical Inflows
        if (['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN', 'SWAP', 'UNSTAKE'].includes(action)) {
          balances[assetType].amount += Number(tx.asset_in_amount);
        }
      }

      // Handle Outgoing Assets
      if (tx.asset_out_symbol && tx.asset_out_amount > 0) {
        const assetType = tx.metadata?.fungible_asset_activities?.find((a: any) => a.type?.toLowerCase().includes('withdraw') || a.type?.toLowerCase().includes('sent'))?.asset_type || tx.asset_out_symbol;
        if (!balances[assetType]) balances[assetType] = { amount: 0, symbol: tx.asset_out_symbol };
        
        // Logical Outflows
        if (['SEND', 'DEPOSIT', 'BORROW', 'BRIDGE_OUT', 'SWAP', 'STAKE'].includes(action)) {
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
