import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { reconstructHistoricalBalances } from './portfolioService.ts';

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
function enrichTransaction(tx: any, walletAddress: string, labelsMap: Map<string, any> = new Map()) {
  const ut = tx.user_transaction || {};
  const functionId = ut.entry_function_id_str || '';

  // Combine FA and Coin activities
  const activities = [
    ...(tx.fungible_asset_activities || []),
    ...(tx.coin_activities || []).map((ca: any) => {
      // Extract actual symbol from coin_type (e.g. "0x1::aptos_coin::AptosCoin" → "MOVE")
      const coinType = ca.coin_type || '';
      let symbol = 'MOVE';
      if (coinType.includes('aptos_coin')) {
        symbol = 'MOVE';
      } else {
        // Try to extract from the last segment: "0xaddr::module::CoinName" → "CoinName"
        const parts = coinType.split('::');
        if (parts.length >= 3) {
          symbol = parts[parts.length - 1].replace(/[<>]/g, '');
        }
      }
      return {
        ...ca,
        type: ca.activity_type,
        asset_type: ca.coin_type,
        metadata: { symbol, decimals: 8 }
      };
    })
  ];

  // Protocol Detection Registry (Ported from frontend for consistency)
  const PROTOCOLS = [
    { name: 'Mosaic', addresses: ['0x03f739', '0x26a95d', '0xede23e', '0x3f7399'], keywords: ['mosaic'] },
    { name: 'Echelon', addresses: ['0x2c7bcc', '0x6a01d5'], keywords: ['echelon'] },
    { name: 'Aries', addresses: ['0xe399b9'], keywords: ['aries'] },
    { name: 'Yuzu', addresses: ['0x4bf519', '0x46566b'], keywords: ['yuzu'] },
    { name: 'LayerBank', addresses: ['0xf257d4'], keywords: ['layerbank'] },
    { name: 'Canopy', addresses: ['0x717b41', '0xb10bd3', '0x5cd341'], keywords: ['canopy', 'stmove'] },
    { name: 'MovePosition', addresses: ['0xccd262'], keywords: ['moveposition'] },
    { name: 'Joule', addresses: ['0x6a1641'], keywords: ['joule'] },
    { name: 'Meridian', addresses: ['0x8f396e', '0x2712eb', '0xfbdb3d', '0x88def5'], keywords: ['meridian'] },
    { name: 'Razor', addresses: ['0xc4e68f'], keywords: ['razor'] },
    { name: 'Interest Protocol', addresses: ['0x323381'], keywords: ['interest'] },
    { name: 'Avante', addresses: ['0x739a88'], keywords: ['avante'] },
    { name: 'Liquidswap', addresses: ['0x830462'], keywords: ['liquidswap'] },
    { name: 'Capygo', addresses: ['0x8b02d2'], keywords: ['capygo', 'mining'] },
    { name: 'Tradeport', addresses: ['0xf81bea'], keywords: ['tradeport'] },
    { name: 'BRKT', addresses: ['0xc85e09'], keywords: ['brkt'] },
    { name: 'Moversmap', addresses: ['0x8c15ae'], keywords: ['moversmap'] },
    { name: 'Movement Core', addresses: ['0x1::'], keywords: [] }
  ];

  let protocol = 'Unknown';
  const lowerFn = functionId.toLowerCase();

  // Match by address prefix or keywords
  for (const p of PROTOCOLS) {
    if (p.addresses.some(addr => lowerFn.includes(addr)) || p.keywords.some(kw => lowerFn.includes(kw))) {
      protocol = p.name;
      break;
    }
  }

  // Action Classification (Enhanced)
  let action = 'OTHER';
  let category = 'Transfer';
  let description = 'Unknown transaction';

  const suffix = lowerFn.split('::').pop() || '';

  // Function Suffix Mapping - must be consistent with transactionRoutes.ts ACTION_TO_TX_TYPE
  const actionMap: Record<string, string> = {
    // Swaps
    'swap': 'SWAP', 'swap_entry': 'SWAP', 'mosaic_swap_with_fee': 'SWAP',
    'swap_exact_in_stable_entry': 'SWAP', 'swap_exact_in_metastable_entry': 'SWAP',
    'swap_exact_in_weighted_entry': 'SWAP', 'swap_exact_in_router_entry': 'SWAP',
    'swap_exact_coin_for_fa_multi_hops': 'SWAP',
    // Lending/Supply (user deposits to earn yield)
    'supply': 'LEND', 'lend_v2': 'LEND', 'lend': 'LEND',
    // Staking (user locks tokens)
    'stake': 'STAKE', 'add_stake': 'STAKE', 'reactivate_stake': 'STAKE', 'stake_and_mint': 'STAKE',
    'deposit_fa_with_coin_type': 'STAKE',
    // Deposits to protocols (not lending, not staking)
    'deposit': 'DEPOSIT', 'deposit_fa': 'DEPOSIT', 'deposit_coin': 'DEPOSIT',
    'add_liquidity': 'DEPOSIT', 'add_liquidity_stable_entry': 'DEPOSIT', 'add_liquidity_weighted_entry': 'DEPOSIT',
    // Borrows
    'borrow': 'BORROW', 'borrow_v2': 'BORROW',
    // Repayments
    'repay': 'REPAY', 'repay_v2': 'REPAY',
    // Claims/Rewards
    'claim': 'CLAIM', 'harvest': 'CLAIM', 'claim_reward': 'CLAIM', 'collect_reward': 'CLAIM',
    'collect_multi_rewards': 'CLAIM', 'collect_fee': 'CLAIM',
    // Withdrawals (getting back deposited assets)
    'withdraw': 'WITHDRAW', 'redeem': 'WITHDRAW', 'redeem_v2': 'WITHDRAW',
    'withdraw_fa': 'WITHDRAW', 'withdraw_coin': 'WITHDRAW',
    'remove_liquidity': 'WITHDRAW', 'remove_liquidity_entry': 'WITHDRAW',
    // Unstaking
    'unstake': 'UNSTAKE', 'unlock': 'UNSTAKE', 'withdraw_pending_inactive': 'UNSTAKE',
    'withdraw_stake': 'UNSTAKE',
    // Transfers
    'transfer': 'SEND', 'transfer_coins': 'SEND', 'batch_transfer_coins': 'SEND',
  };

  if (actionMap[suffix]) {
    action = actionMap[suffix];
    category = action === 'SEND' ? 'Transfer' : 'DeFi';
  }

  // Action & Asset Extraction using Event Types
  const inFlows = activities.filter((a: any) => {
    const type = String(a.type).toLowerCase();
    return (type.includes('deposit') || type.includes('received') || type.includes('credit')) && a.owner_address === walletAddress;
  });
  const outFlows = activities.filter((a: any) => {
    const type = String(a.type).toLowerCase();
    return (type.includes('withdraw') || type.includes('sent') || type.includes('debit')) && a.owner_address === walletAddress;
  });

  // Action-Specific Refinements & Description Generation
  if (action === 'SWAP') {
    category = 'DeFi';
    const assetIn = outFlows[0];
    const assetOut = inFlows[0];
    if (assetIn && assetOut) {
      const amtIn = Math.abs(assetIn.amount / Math.pow(10, assetIn.metadata?.decimals || 8));
      const amtOut = Math.abs(assetOut.amount / Math.pow(10, assetOut.metadata?.decimals || 8));
      description = `Swapped ${amtIn.toFixed(2)} ${assetIn.metadata?.symbol} for ${amtOut.toFixed(2)} ${assetOut.metadata?.symbol}`;
    } else {
      description = `Swapped assets via ${protocol}`;
    }
  } else if (action === 'DEPOSIT') {
    category = 'DeFi';
    const asset = outFlows[0] || inFlows[0];
    if (asset) {
      const amt = Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8));
      description = `Deposited ${amt.toFixed(2)} ${asset.metadata?.symbol} into ${protocol}`;
    } else {
      description = `Deposited assets into ${protocol}`;
    }
  } else if (action === 'BORROW') {
    category = 'DeFi';
    description = `Borrowed assets from ${protocol}`;
  } else if (action === 'CLAIM') {
    category = 'DeFi';
    const asset = inFlows[0];
    description = asset
      ? `Claimed ${Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8)).toFixed(2)} ${asset.metadata?.symbol} rewards`
      : `Claimed rewards from ${protocol}`;
  } else if (action === 'SEND' || action === 'RECEIVE' || (action === 'OTHER' && (inFlows.length > 0 || outFlows.length > 0))) {
    // Determine if it's a transfer if not already set
    if (action === 'OTHER') {
      action = outFlows.length > 0 ? 'SEND' : 'RECEIVE';
    }

    category = 'Transfer';
    const asset = outFlows[0] || inFlows[0];
    if (asset) {
      const amt = Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8));
      description = `${action === 'SEND' ? 'Sent' : 'Received'} ${amt.toFixed(2)} ${asset.metadata?.symbol}`;
    }

    // Attempt to identify counterparty from payload for labels (if available)
    if (action === 'SEND') {
      const payload = ut.payload || null;
      let receiver = null;
      if (payload?.function === '0x1::aptos_account::transfer' || payload?.function === '0x1::coin::transfer') {
        receiver = payload.arguments?.[0];
      } else if (payload?.entry_function_id_str?.includes('transfer')) {
        receiver = payload.arguments?.[0];
      }

      if (receiver) {
        const label = labelsMap.get(normalizeAddress(receiver));
        if (label) {
          protocol = label.tracked_entities?.name || 'Exchange';
          description += ` to ${protocol}`;
        }
      }
    }
  } else if (action === 'REGISTER') {
    category = 'Account';
    description = 'Registered new asset/account';
  } else if (action === 'WITHDRAW') {
    category = 'DeFi';
    const asset = inFlows[0] || outFlows[0];
    if (asset) {
      const amt = Math.abs(asset.amount / Math.pow(10, asset.metadata?.decimals || 8));
      description = `Withdrew ${amt.toFixed(2)} ${asset.metadata?.symbol} from ${protocol}`;
    } else {
      description = `Withdrew assets from ${protocol}`;
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
  const BATCH_SIZE = 50;
  let totalSynced = 0;

  console.log(`[DeepSync] 🚀 Starting deep history pull for ${address}...`);

  // Fetch all labels for counterparty identification
  const labelsMap = new Map();
  const { data: labelsData } = await supabase.from('address_labels').select('*, tracked_entities(name)');
  if (labelsData) {
    labelsData.forEach(l => labelsMap.set(normalizeAddress(l.address), l));
  }

  // 1. Fetch current sync status
  const { data: statusData } = await supabase
    .from('user_sync_status')
    .select('*')
    .eq('user_address', address)
    .maybeSingle();

  // 2. Fetch total transaction count from indexer
  let totalTransactions = statusData?.total_transactions || 0;
  try {
    const countRes = await fetch(MOVEMENT_INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query TotalTransactions($address: String!) {
          account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
            aggregate { count }
          }
        }`,
        variables: { address }
      })
    });
    const countJson: any = await countRes.json();
    const indexerCount = countJson.data?.account_transactions_aggregate?.aggregate?.count || 0;
    
    // Only update if indexerCount is greater to prevent progress resetting
    if (indexerCount > totalTransactions) {
      totalTransactions = indexerCount;
    }
  } catch (e) {
    console.warn(`[DeepSync] Could not fetch total count for ${address}, using fallback: ${totalTransactions}`);
  }

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

  // CRITICAL FIX: If the history table was cleared manually, reset the sync status
  let isFullySynced = statusData?.full_history_synced === true;
  if (maxVersionStr === "0" && isFullySynced) {
    console.log(`[DeepSync] ⚠️ History was cleared but status was 'synced'. Resetting for ${address}...`);
    isFullySynced = false;
    await supabase.from('user_sync_status').update({ 
      full_history_synced: false, 
      synced_transactions: 0,
      total_transactions: totalTransactions // Update with latest discovery
    }).eq('user_address', address);
  }

  // Mark status as currently syncing with total count
  await supabase.from('user_sync_status').upsert({
    user_address: address,
    last_sync_at: new Date().toISOString(),
    full_history_synced: false,
    total_transactions: totalTransactions,
    synced_transactions: statusData?.synced_transactions || 0
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

      const enriched = txs.map((tx: any) => enrichTransaction(tx, address, labelsMap));
      const { error: upsertError } = await supabase
        .from('user_transaction_history')
        .upsert(enriched, { onConflict: 'user_address,version' });

      if (upsertError) throw upsertError;


      totalSynced += txs.length;
      gtVersion = txs[txs.length - 1].transaction_version;

      // Update progress in DB
      const { count: currentCount } = await supabase
        .from('user_transaction_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_address', address);

      await supabase.from('user_sync_status').update({
        last_synced_version: String(gtVersion),
        synced_transactions: currentCount || totalSynced,
        last_sync_at: new Date().toISOString()
      }).eq('user_address', address);

      if (txs.length < BATCH_SIZE) hasMoreForward = false;
      await new Promise(r => setTimeout(r, 200));
    }

    // Update status to let frontend know we've pulled new items
    await supabase.from('user_sync_status').update({
      last_synced_version: String(gtVersion),
      last_sync_at: new Date().toISOString()
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

        const enriched = txs.map((tx: any) => enrichTransaction(tx, address, labelsMap));
        const { error: upsertError } = await supabase
          .from('user_transaction_history')
          .upsert(enriched, { onConflict: 'user_address,version' });

        if (upsertError) throw upsertError;


        totalSynced += txs.length;
        ltVersion = txs[txs.length - 1].transaction_version;

        // Update progress in DB
        const { count: currentCount } = await supabase
          .from('user_transaction_history')
          .select('*', { count: 'exact', head: true })
          .eq('user_address', address);

        await supabase.from('user_sync_status').update({
          last_synced_version: String(ltVersion),
          synced_transactions: currentCount || totalSynced,
          last_sync_at: new Date().toISOString()
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
    
    // Trigger portfolio reconstruction to update snapshots
    try {
      await reconstructHistoricalBalances(supabase, address);
    } catch (reconstructErr) {
      console.error(`[DeepSync] ⚠️ Portfolio reconstruction failed but sync succeeded:`, reconstructErr);
    }

    return { totalSynced };

  } catch (err: any) {
    console.error(`[DeepSync] ❌ Fatal error for ${address}:`, err.message);
    await supabase.from('user_sync_status').update({ sync_error: err.message }).eq('user_address', address);
    throw err;
  }
}

/**
 * Maintenance function to fix "Unknown" protocols in DB
 */
export async function reProcessUnknownTransactions(supabase: SupabaseClient) {
  console.log('[DeepSync] 🛠️  Starting "Unknown" protocol cleanup...');

  // 1. Fetch labels once
  const labelsMap = new Map();
  const { data: labelsData } = await supabase.from('address_labels').select('*, tracked_entities(name)');
  if (labelsData) {
    labelsData.forEach(l => labelsMap.set(normalizeAddress(l.address), l));
  }

  // 2. Fetch all transactions marked as Unknown (limited batch)
  const { data: unknowns, error } = await supabase
    .from('user_transaction_history')
    .select('*')
    .eq('protocol', 'Unknown')
    .limit(500);

  if (error || !unknowns) return;

  console.log(`[DeepSync] Found ${unknowns.length} unknown transactions to re-process.`);

  for (const row of unknowns) {
    try {
      const meta = row.metadata || {};

      // Reconstruct a compatible 'tx' object for enrichTransaction
      const pseudoTx = {
        transaction_version: row.version,
        user_transaction: {
          hash: row.hash,
          timestamp: row.timestamp,
          entry_function_id_str: meta.entry_function_id_str || '',
          success: meta.success ?? true
        },
        fungible_asset_activities: meta.fungible_asset_activities || [],
        coin_activities: meta.coin_activities || []
      };

      const enriched = enrichTransaction(pseudoTx, row.user_address, labelsMap);

      // Update the row
      await supabase
        .from('user_transaction_history')
        .update({
          protocol: enriched.protocol,
          action: enriched.action,
          category: enriched.category,
          description: enriched.description,
          asset_in_symbol: enriched.asset_in_symbol,
          asset_in_amount: enriched.asset_in_amount,
          asset_out_symbol: enriched.asset_out_symbol,
          asset_out_amount: enriched.asset_out_amount
        })
        .eq('user_address', row.user_address)
        .eq('version', row.version);

    } catch (err) {
      console.error(`[DeepSync] Failed to re-process version ${row.version}`);
    }
  }

  console.log('[DeepSync] ✅ Cleanup complete.');
}
