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
      coin_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        coin_type
        activity_type
        is_transaction_success
        entry_function_id_str
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

  // Combine FA and Coin activities
  const activities = [
    ...(tx.fungible_asset_activities || []),
    ...(tx.coin_activities || []).map((ca: any) => ({
      ...ca,
      type: ca.activity_type,
      asset_type: ca.coin_type,
      metadata: { symbol: ca.coin_type.includes('aptos_coin') ? 'APT' : 'MOVE', decimals: 8 }
    }))
  ];

  let protocol = 'Unknown';
  let action = 'OTHER';
  let category = 'Transfer';
  let description = 'Unknown transaction';

  // Protocol Detection
  if (functionId.includes('0x8304621d305021a1')) protocol = 'Liquidswap';
  else if (functionId.includes('0x2c7bccf7df3d0c01') || functionId.includes('0x6a01d5')) protocol = 'Echelon';
  else if (functionId.includes('0x1::')) protocol = 'Movement Core';
  else if (functionId.includes('0xe399b9')) protocol = 'Aries';
  else if (functionId.includes('0xede23e') || functionId.includes('0x3f7399')) protocol = 'Mosaic';
  else if (functionId.includes('0x4bf519')) protocol = 'Yuzu';
  else if (functionId.includes('0xf257d4')) protocol = 'LayerBank';
  else if (functionId.includes('0x717b41') || functionId.includes('0xb10bd3') || functionId.includes('0x5cd341')) protocol = 'Canopy';
  else if (functionId.includes('0xccd262')) protocol = 'MovePosition';
  else if (functionId.includes('0x6a1641')) protocol = 'Joule';
  else if (functionId.includes('0x8f396e') || functionId.includes('0x2712eb') || functionId.includes('0xfbdb3d')) protocol = 'Meridian';
  else if (functionId.includes('0xc4e68f')) protocol = 'Razor';

  // Action & Asset Extraction using Event Types
  const inFlows = activities.filter((a: any) => String(a.type).includes('Deposit') && a.owner_address === walletAddress);
  const outFlows = activities.filter((a: any) => String(a.type).includes('Withdraw') && a.owner_address === walletAddress);

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

  // 3. Storage Optimization: Strip bloated metadata
  const optimizedMetadata = {
    hash: ut.hash || `v${tx.transaction_version}`,
    entry_function_id_str: functionId,
    success: tx.user_transaction?.success ?? true,
    // Only keep essential activity info
    fungible_asset_activities: (tx.fungible_asset_activities || []).map((a: any) => ({
      amount: a.amount,
      asset_type: a.asset_type,
      type: a.type,
      metadata: a.metadata
    })),
    coin_activities: (tx.coin_activities || []).map((a: any) => ({
      amount: a.amount,
      coin_type: a.coin_type,
      activity_type: a.activity_type
    }))
  };

  return {
    user_address: walletAddress,
    version: tx.transaction_version,
    hash: ut.hash || `v${tx.transaction_version}`,
    timestamp: ut.timestamp,
    protocol,
    action,
    category,
    description,
    asset_in_symbol: inFlows[0]?.metadata?.symbol || null,
    asset_in_amount: inFlows[0] ? Math.abs(inFlows[0].amount / Math.pow(10, inFlows[0].metadata?.decimals || 8)) : null,
    asset_out_symbol: outFlows[0]?.metadata?.symbol || null,
    asset_out_amount: outFlows[0] ? Math.abs(outFlows[0].amount / Math.pow(10, outFlows[0].metadata?.decimals || 8)) : null,
    metadata: optimizedMetadata,
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
  // Using max signed bigint instead of u64 max to avoid 'out of range' indexer error
  let ltVersion: string = "9223372036854775807";
  let totalSynced = 0;
  let hasMore = true;
  const BATCH_SIZE = 50;
  const MAX_BATCHES = 100; // Safety limit: Max 5,000 transactions per sync trigger
  let batchCount = 0;

  console.log(`[DeepSync] 🚀 Starting deep history pull for ${address}...`);

  // Initialize sync status
  await supabase.from('user_sync_status').upsert({
    user_address: address,
    last_sync_at: new Date().toISOString(),
    full_history_synced: false
  });

  try {
    while (hasMore && batchCount < MAX_BATCHES) {
      batchCount++;
      console.log(`[DeepSync] Fetching batch ${batchCount}/${MAX_BATCHES} (lt_version: ${ltVersion})...`);

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
        throw new Error(`Indexer query failed: ${JSON.stringify(json.errors)}`);
      }

      const txs = json.data?.account_transactions || [];
      console.log(`[DeepSync] Found ${txs.length} transactions.`);

      if (txs.length === 0) {
        hasMore = false;
        break;
      }

      const enriched = txs.map((tx: any) => enrichTransaction(tx, address));

      const { error: upsertError } = await supabase
        .from('user_transaction_history')
        .upsert(enriched, { onConflict: 'user_address,version' });

      if (upsertError) {
        console.error('[DeepSync] Supabase Error:', upsertError);
        throw upsertError;
      }

      totalSynced += txs.length;
      ltVersion = txs[txs.length - 1].transaction_version;

      // Update status for frontend progress
      await supabase.from('user_sync_status').update({
        last_synced_version: String(ltVersion)
      }).eq('user_address', address);

      if (txs.length < BATCH_SIZE) {
        hasMore = false;
      }

      // Slightly longer wait to ensure indexer stability
      await new Promise(r => setTimeout(r, 200));
    }

    if (batchCount >= MAX_BATCHES) {
      console.warn(`[DeepSync] ⚠️ Sync budget reached for ${address}. More transactions may remain.`);
    }

    await supabase.from('user_sync_status').update({
      full_history_synced: !hasMore, // Only true if we actually finished
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
