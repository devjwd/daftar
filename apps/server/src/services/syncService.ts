import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { MovementTransaction, BadgeDefinition } from '@daftar/types';

const MOVEMENT_INDEXER_URL = CONFIG.MOVEMENT.INDEXER_URL;

const GET_USER_TRANSACTIONS = `
  query WalletTransactions($address: String!, $limit: Int!) {
    account_transactions(
      where: { account_address: { _eq: $address } }
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
 * Basic transaction classifier for backend sync.
 * (Ported and simplified from historyEngine.js)
 */
function classifyAndNormalize(tx: any, walletAddress: string): MovementTransaction & { source: string; fetched_at: string } {
  const userAddr = normalizeAddress(walletAddress);
  const ut = tx.user_transaction || {};
  const functionName = ut.entry_function_id_str || '';

  const timestamp = ut.timestamp ? new Date(ut.timestamp).toISOString() : new Date().toISOString();
  const txHash = ut.hash || `v${tx.transaction_version}`;

  // Basic type detection
  let type: MovementTransaction['tx_type'] = 'other';
  if (functionName.includes('swap')) type = 'swap';
  else if (functionName.includes('transfer')) type = 'transfer';
  else if (functionName.includes('mint')) type = 'mint';

  // Identify dApp
  let dappName = 'Unknown Contract';
  if (functionName.includes('0x1::')) dappName = 'Movement Core';
  else if (functionName.includes('0x8304621d305021a1')) dappName = 'Liquidswap';
  else if (functionName.includes('0x2c7bccf7df3d0c01')) dappName = 'Echelon Finance';

  return {
    wallet_address: userAddr,
    tx_hash: txHash,
    tx_type: type,
    dapp_name: dappName,
    status: 'success',
    source: 'indexer_sync',
    tx_timestamp: timestamp,
    fetched_at: new Date().toISOString()
  };
}

export async function syncUserTransactions(
  supabase: SupabaseClient,
  walletAddress: string,
  limit: number = 50
): Promise<{ count: number }> {
  const address = normalizeAddress(walletAddress);
  if (!address) throw new Error('Invalid address');

  console.log(`[Sync] Starting sync for ${address}...`);

  const response = await fetch(MOVEMENT_INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_USER_TRANSACTIONS,
      variables: { address, limit }
    })
  });

  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.statusText}`);
  }

  const json: any = await response.json();
  const txs = json.data?.account_transactions || [];

  if (txs.length === 0) {
    return { count: 0 };
  }

  const normalized = txs.map((tx: any) => classifyAndNormalize(tx, address));

  const { error } = await supabase
    .from('transaction_history')
    .upsert(normalized, { onConflict: 'tx_hash' });

  if (error) {
    console.error('[Sync] Upsert error:', error);
    throw error;
  }

  console.log(`[Sync] Successfully synced ${normalized.length} transactions for ${address}`);
  return { count: normalized.length };
}

/**
 * Audit and Sync Badge Definitions
 */
async function fetchView(fn: string, args: any[] = []): Promise<any> {
  const fullnodeUrl = CONFIG.MOVEMENT.RPC_URL.replace(/\/$/, '');
  const response = await fetch(`${fullnodeUrl}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: fn,
      type_arguments: [],
      arguments: args
    })
  });
  if (!response.ok) return null;
  const json: any = await response.json();
  return json;
}

export async function auditBadgeDefinitions(supabase: SupabaseClient) {
  const moduleAddr = CONFIG.SIGNER.MODULE_ADDRESS;
  if (!moduleAddr) throw new Error('Badge module address not configured');

  console.log('[Audit] Starting badge integrity audit...');

  // 1. Fetch on-chain IDs
  const registryFn = `${moduleAddr}::badges::get_badge_ids`;
  const onChainIdsRaw = await fetchView(registryFn);
  const onChainIds = Array.isArray(onChainIdsRaw?.[0]) ? onChainIdsRaw[0].map(Number) : [];

  // 2. Fetch DB definitions
  const { data: dbBadges } = await supabase
    .from('badge_definitions')
    .select('*')
    .eq('is_deleted', false);
  
  const dbMap = new Map(dbBadges?.map(b => [Number(b.on_chain_badge_id), b]) || []);

  const results = {
    total_on_chain: onChainIds.length,
    missing_in_db: [] as number[],
    drifted: [] as any[],
    synced: 0
  };

  // 3. Compare each on-chain badge
  for (const id of onChainIds) {
    const onChainData = await fetchView(`${moduleAddr}::badges::get_badge_info_v2`, [id]);
    if (!onChainData) continue;

    const dbBadge = dbMap.get(id);
    if (!dbBadge) {
      results.missing_in_db.push(id);
      continue;
    }

    // Deep compare key fields
    const drift = [];
    if (dbBadge.name !== String(onChainData[0])) drift.push('name');
    if (dbBadge.status !== Number(onChainData[2])) drift.push('status');
    if (Number(dbBadge.mint_fee) !== Number(onChainData[3])) drift.push('mint_fee');
    if (Number(dbBadge.max_supply) !== Number(onChainData[5])) drift.push('max_supply');
    if (Number(dbBadge.xp) !== Number(onChainData[6])) drift.push('xp');

    if (drift.length > 0) {
      results.drifted.push({ id, badge_id: dbBadge.badge_id, fields: drift });
    } else {
      results.synced++;
    }
  }

  console.log(`[Audit] Complete. Synced: ${results.synced}, Drifted: ${results.drifted.length}, Missing: ${results.missing_in_db.length}`);
  return results;
}

