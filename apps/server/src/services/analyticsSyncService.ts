import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';

const MOVEMENT_INDEXER_URL = CONFIG.MOVEMENT.INDEXER_URL;

// GraphQL query for deep transaction history
const GET_USER_TRANSACTIONS_PAGINATED = `
  query WalletTransactions($address: String!, $limit: Int!, $lt_version: bigint) {
    account_transactions(
      where: { 
        account_address: { _eq: $address },
        transaction_version: { _lt: $lt_version }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
      user_transaction {
        hash
        sender
        timestamp
        entry_function_id_str
      }
      fungible_asset_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        asset_type
        type
        is_transaction_success
        entry_function_id_str
        metadata {
          symbol
          decimals
        }
      }
    }
  }
`;

/**
 * Deep classifier and humanizer for analytics
 */
function enrichTransaction(tx: any, walletAddress: string) {
  const ut = tx.user_transaction || {};
  const functionId = ut.entry_function_id_str || '';
  const activities = tx.fungible_asset_activities || [];
  
  let protocol = 'Unknown';
  let action = 'OTHER';
  let category = 'Transfer';
  let description = 'Unknown transaction';
  
  // Protocol Detection
  if (functionId.includes('0x8304621d305021a1')) protocol = 'Liquidswap';
  else if (functionId.includes('0x2c7bccf7df3d0c01')) protocol = 'Echelon';
  else if (functionId.includes('0x1::')) protocol = 'Movement Core';
  else if (functionId.includes('0xe399b9')) protocol = 'Aries';

  // Action & Asset Extraction
  const outFlows = activities.filter((a: any) => a.amount > 0 && a.owner_address === walletAddress);
  const inFlows = activities.filter((a: any) => a.amount < 0 && a.owner_address === walletAddress);

  if (functionId.includes('swap')) {
    action = 'SWAP';
    category = 'DeFi';
    const assetIn = outFlows[0];
    const assetOut = inFlows[0];
    if (assetIn && assetOut) {
      const amtIn = Math.abs(assetIn.amount / Math.pow(10, assetIn.metadata?.decimals || 8));
      const amtOut = Math.abs(assetOut.amount / Math.pow(10, assetOut.metadata?.decimals || 8));
      description = `Swapped ${amtIn.toFixed(2)} ${assetIn.metadata?.symbol} for ${amtOut.toFixed(2)} ${assetOut.metadata?.symbol}`;
    }
  } else if (functionId.includes('supply') || functionId.includes('deposit')) {
    action = 'DEPOSIT';
    category = 'DeFi';
    const asset = outFlows[0];
    if (asset) {
      const amt = Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8));
      description = `Deposited ${amt.toFixed(2)} ${asset.metadata?.symbol} into ${protocol}`;
    }
  } else if (functionId.includes('borrow')) {
    action = 'BORROW';
    category = 'DeFi';
    description = `Borrowed assets from ${protocol}`;
  } else if (functionId.includes('transfer')) {
    action = outFlows.length > 0 ? 'SEND' : 'RECEIVE';
    category = 'Transfer';
    const asset = outFlows[0] || inFlows[0];
    if (asset) {
      const amt = Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8));
      description = `${action === 'SEND' ? 'Sent' : 'Received'} ${amt.toFixed(2)} ${asset.metadata?.symbol}`;
    }
  }

  return {
    user_address: walletAddress,
    version: tx.transaction_version,
    hash: ut.hash,
    timestamp: ut.timestamp,
    protocol,
    action,
    category,
    description,
    asset_in_symbol: inFlows[0]?.metadata?.symbol || null,
    asset_in_amount: inFlows[0] ? Math.abs(inFlows[0].amount / Math.pow(10, inFlows[0].metadata?.decimals || 8)) : null,
    asset_out_symbol: outFlows[0]?.metadata?.symbol || null,
    asset_out_amount: outFlows[0] ? Math.abs(outFlows[0].amount / Math.pow(10, outFlows[0].metadata?.decimals || 8)) : null,
    metadata: tx,
    is_processed: false
  };
}

/**
 * Main deep sync loop
 */
export async function syncFullUserHistory(
  supabase: SupabaseClient,
  walletAddress: string
) {
  const address = normalizeAddress(walletAddress);
  let ltVersion: string | null = null; // Start with null to get latest
  let totalSynced = 0;
  let hasMore = true;
  const BATCH_SIZE = 50; // Smaller batches are safer for deep sync

  console.log(`[DeepSync] 🚀 Starting deep history pull for ${address}...`);

  // Initialize sync status
  await supabase.from('user_sync_status').upsert({
    user_address: address,
    last_sync_at: new Date().toISOString(),
    full_history_synced: false
  });

  try {
    while (hasMore) {
      console.log(`[DeepSync] Fetching batch (lt_version: ${ltVersion || 'LATEST'})...`);
      
      const response = await fetch(MOVEMENT_INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GET_USER_TRANSACTIONS_PAGINATED,
          variables: { 
            address, 
            limit: BATCH_SIZE, 
            lt_version: ltVersion 
          }
        })
      });

      const json: any = await response.json();
      
      if (json.errors) {
        console.error('[DeepSync] Indexer GraphQL Error:', json.errors);
        throw new Error('Indexer query failed');
      }

      const txs = json.data?.account_transactions || [];
      console.log(`[DeepSync] Found ${txs.length} transactions in this batch.`);

      if (txs.length === 0) {
        hasMore = false;
        break;
      }

      const enriched = txs.map((tx: any) => enrichTransaction(tx, address));
      
      const { error } = await supabase
        .from('user_transaction_history')
        .upsert(enriched, { onConflict: 'user_address,version' });

      if (error) {
        console.error('[DeepSync] Supabase Upsert Error:', error);
        throw error;
      }

      totalSynced += txs.length;
      ltVersion = txs[txs.length - 1].transaction_version;

      // Update status for frontend progress
      await supabase.from('user_sync_status').update({
        last_synced_version: ltVersion
      }).eq('user_address', address);

      // Stop if batch is smaller than limit (reached the end)
      if (txs.length < BATCH_SIZE) {
        hasMore = false;
      }

      // Small cooldown to avoid hitting indexer limits
      await new Promise(r => setTimeout(r, 100));
    }

    await supabase.from('user_sync_status').update({
      full_history_synced: true,
      last_sync_at: new Date().toISOString()
    }).eq('user_address', address);

    console.log(`[DeepSync] ✅ Successfully synced ${totalSynced} transactions for ${address}`);
    return { totalSynced };
    
  } catch (err: any) {
    console.error(`[DeepSync] ❌ Fatal error for ${address}:`, err.message);
    await supabase.from('user_sync_status').update({ sync_error: err.message }).eq('user_address', address);
    throw err;
  }
}
