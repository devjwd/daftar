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

// GraphQL query for forward incremental sync (new transactions)
const GET_USER_TRANSACTIONS_FORWARD_PAGINATED = `
  query WalletTransactionsForward($address: String!, $limit: Int!, $gt_version: bigint) {
    account_transactions(
      where: { 
        account_address: { _eq: $address },
        transaction_version: { _gt: $gt_version }
      }
      order_by: { transaction_version: asc }
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
 * Detects if any transaction in the batch represents a sweep to an exchange hub.
 */
async function detectExchangeDepositsBatch(rawTxs: any[], enrichedTxs: any[], supabase: SupabaseClient) {
  if (!rawTxs || rawTxs.length === 0) return;

  const potentialHubs = new Set<string>();
  const txHubMap = new Map<string, { sender: string, hub: string }>();

  for (let i = 0; i < enrichedTxs.length; i++) {
    const enriched = enrichedTxs[i];
    if (enriched.action !== 'SEND') continue;

    const rawTx = rawTxs.find((t: any) => t.transaction_version === enriched.version);
    if (!rawTx) continue;

    const activities = [
      ...(rawTx.fungible_asset_activities || []),
      ...(rawTx.coin_activities || []).map((ca: any) => ({ ...ca, type: ca.activity_type, owner_address: ca.owner_address }))
    ];
    
    const deposit = activities.find((a: any) => String(a.type).includes('Deposit') && a.owner_address !== enriched.user_address);
    if (deposit && deposit.owner_address) {
      potentialHubs.add(deposit.owner_address);
      txHubMap.set(String(enriched.version), { sender: enriched.user_address, hub: deposit.owner_address });
    }
  }

  if (potentialHubs.size === 0) return;

  const { data: entities } = await supabase
    .from('tracked_entities')
    .select('id, address, name')
    .in('address', Array.from(potentialHubs))
    .eq('category', 'Exchange');

  if (!entities || entities.length === 0) return;

  const entityMap = new Map(entities.map(e => [e.address, e]));
  const labelsToInsert = [];

  for (const { sender, hub } of txHubMap.values()) {
    const entity = entityMap.get(hub);
    if (entity) {
      labelsToInsert.push({
        address: sender,
        label_name: `${entity.name} Deposit Address`,
        entity_id: entity.id,
        discovery_method: 'sweep_pattern'
      });
    }
  }

  if (labelsToInsert.length > 0) {
    try {
      await supabase.from('address_labels').upsert(labelsToInsert, { onConflict: 'address' });
      console.log(`[Detection] Tagged ${labelsToInsert.length} exchange deposit addresses.`);
    } catch (err: any) {
      console.warn(`[Detection] Failed to insert labels:`, err.message);
    }
  }
}

/**
 * Main deep sync loop
 */
export async function syncFullUserHistory(
  supabase: SupabaseClient,
  walletAddress: string
) {
  const address = normalizeAddress(walletAddress);
  const BATCH_SIZE = 50;
  let totalSynced = 0;

  console.log(`[DeepSync] 🚀 Starting deep history pull for ${address}...`);

  // 1. Fetch current sync status and max/min versions from database
  const { data: statusData } = await supabase
    .from('user_sync_status')
    .select('*')
    .eq('user_address', address)
    .maybeSingle();

  const isFullySynced = statusData?.full_history_synced === true;

  const { data: maxData } = await supabase
    .from('user_transaction_history')
    .select('version')
    .eq('user_address', address)
    .order('version', { ascending: false })
    .limit(1);

  const { data: minData } = await supabase
    .from('user_transaction_history')
    .select('version')
    .eq('user_address', address)
    .order('version', { ascending: true })
    .limit(1);

  let maxVersionStr = maxData && maxData.length > 0 ? String(maxData[0].version) : "0";
  let minVersionStr = minData && minData.length > 0 ? String(minData[0].version) : "9223372036854775807";

  // Mark status as currently syncing
  await supabase.from('user_sync_status').upsert({
    user_address: address,
    last_sync_at: new Date().toISOString(),
    full_history_synced: false 
  });

  try {
    // --- PHASE 1: FORWARD SYNC (New Transactions) ---
    console.log(`[DeepSync] Phase 1: Forward Sync from > ${maxVersionStr}`);
    let gtVersion = maxVersionStr;
    let hasMoreForward = true;
    let forwardBatchCount = 0;
    const MAX_FORWARD_BATCHES = 50;
    
    while (hasMoreForward && forwardBatchCount < MAX_FORWARD_BATCHES) {
      forwardBatchCount++;
      
      const response = await fetch(MOVEMENT_INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GET_USER_TRANSACTIONS_FORWARD_PAGINATED,
          variables: { address, limit: BATCH_SIZE, gt_version: gtVersion }
        })
      });

      const json: any = await response.json();
      if (json.errors) throw new Error(`Indexer query failed: ${JSON.stringify(json.errors)}`);
      
      const txs = json.data?.account_transactions || [];
      if (txs.length === 0) {
        hasMoreForward = false;
        break;
      }
      
      const enriched = txs.map((tx: any) => enrichTransaction(tx, address));
      const { error: upsertError } = await supabase
        .from('user_transaction_history')
        .upsert(enriched, { onConflict: 'user_address,version' });

      if (upsertError) throw upsertError;

      // Run heuristic detection for exchange deposit addresses
      await detectExchangeDepositsBatch(txs, enriched, supabase);

      totalSynced += txs.length;
      gtVersion = txs[txs.length - 1].transaction_version;
      
      if (txs.length < BATCH_SIZE) hasMoreForward = false;
      await new Promise(r => setTimeout(r, 200));
    }

    // Update status to let frontend know we've pulled new items
    await supabase.from('user_sync_status').update({
      last_synced_version: String(gtVersion)
    }).eq('user_address', address);

    // --- PHASE 2: BACKWARD SYNC (Historical Gaps) ---
    let fullyFinishedHistory = isFullySynced;
    
    if (!isFullySynced) {
      console.log(`[DeepSync] Phase 2: Backward Sync from < ${minVersionStr}`);
      let ltVersion = minVersionStr;
      let hasMoreBackward = true;
      let backwardBatchCount = 0;
      const MAX_BACKWARD_BATCHES = 100;

      while (hasMoreBackward && backwardBatchCount < MAX_BACKWARD_BATCHES) {
        backwardBatchCount++;
        
        const response = await fetch(MOVEMENT_INDEXER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: GET_USER_TRANSACTIONS_PAGINATED,
            variables: { address, limit: BATCH_SIZE, lt_version: ltVersion }
          })
        });

        const json: any = await response.json();
        if (json.errors) throw new Error(`Indexer query failed: ${JSON.stringify(json.errors)}`);
        
        const txs = json.data?.account_transactions || [];
        if (txs.length === 0) {
          hasMoreBackward = false;
          fullyFinishedHistory = true; // Reached the beginning of time
          break;
        }

        const enriched = txs.map((tx: any) => enrichTransaction(tx, address));
        const { error: upsertError } = await supabase
          .from('user_transaction_history')
          .upsert(enriched, { onConflict: 'user_address,version' });

        if (upsertError) throw upsertError;

        // Run heuristic detection for exchange deposit addresses
        await detectExchangeDepositsBatch(txs, enriched, supabase);

        totalSynced += txs.length;
        ltVersion = txs[txs.length - 1].transaction_version;
        
        // Let frontend know we are still crawling deep
        await supabase.from('user_sync_status').update({
          last_synced_version: String(ltVersion)
        }).eq('user_address', address);

        if (txs.length < BATCH_SIZE) {
          hasMoreBackward = false;
          fullyFinishedHistory = true;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (backwardBatchCount >= MAX_BACKWARD_BATCHES) {
        console.warn(`[DeepSync] ⚠️ Backward sync budget reached. More history remains.`);
        fullyFinishedHistory = false;
      }
    }

    // Finalize sync status
    await supabase.from('user_sync_status').update({
      full_history_synced: fullyFinishedHistory,
      last_sync_at: new Date().toISOString()
    }).eq('user_address', address);

    console.log(`[DeepSync] ✅ Sync complete. Total processed this run: ${totalSynced}`);
    return { totalSynced };

  } catch (err: any) {
    console.error(`[DeepSync] ❌ Fatal error for ${address}:`, err.message);
    await supabase.from('user_sync_status').update({ sync_error: err.message }).eq('user_address', address);
    throw err;
  }
}
