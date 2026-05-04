import fetch from 'node-fetch';
import { normalizeAddress } from './utils.js';

const MOVEMENT_INDEXER_URL = process.env.MOVEMENT_INDEXER_URL || 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql';

const GET_USER_TRANSACTIONS = `
  query WalletTransactions($address: String!, $limit: Int!) {
    account_transactions(
      where: { account_address: { _eq: $address } }
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
    }
  }
`;

/**
 * Basic transaction classifier for backend sync.
 * (Ported and simplified from historyEngine.js)
 */
function classifyAndNormalize(tx, walletAddress) {
  const userAddr = normalizeAddress(walletAddress);
  const ut = tx.user_transaction || {};
  const functionName = ut.entry_function_id_str || '';
  
  const timestamp = ut.timestamp ? new Date(ut.timestamp).toISOString() : new Date().toISOString();
  
  // Basic type detection
  let type = 'other';
  if (functionName.includes('swap')) type = 'swap';
  else if (functionName.includes('transfer')) type = 'transfer';
  else if (functionName.includes('mint')) type = 'mint';
  
  // Identify dApp (very basic for now)
  let dappName = 'Unknown Contract';
  if (functionName.includes('0x1::')) dappName = 'Movement Core';
  
  return {
    wallet_address: userAddr,
    tx_hash: `version_${tx.transaction_version}`, // We use version as hash if real hash is missing from indexer output
    tx_type: type,
    dapp_name: dappName,
    status: 'success',
    source: 'indexer_sync',
    tx_timestamp: timestamp,
    fetched_at: new Date().toISOString()
  };
}

export async function syncUserTransactions(supabase, walletAddress, limit = 50) {
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

  const json = await response.json();
  const txs = json.data?.account_transactions || [];
  
  if (txs.length === 0) {
    return { count: 0 };
  }

  const normalized = txs.map(tx => classifyAndNormalize(tx, address));

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
