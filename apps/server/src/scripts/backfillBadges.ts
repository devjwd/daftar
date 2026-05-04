import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';
import { normalizeAddress } from '../utils/address.ts';

const INDEXER_URL = CONFIG.MOVEMENT.INDEXER_URL;
const MODULE_ADDR = normalizeAddress(CONFIG.SIGNER.MODULE_ADDRESS);

const GET_BADGE_EVENTS = `
  query GetBadgeCreatedEvents($moduleAddr: String!) {
    events(
      where: { 
        type: { _eq: $moduleAddr },
        account_address: { _eq: $moduleAddr }
      },
      order_by: { transaction_version: asc }
    ) {
      transaction_version
      data
      indexed_type
    }
    
    account_transactions(
      where: { 
        user_transaction: { 
          entry_function_id_str: { _like: "%badges::create_badge%" }
        }
      }
    ) {
      user_transaction {
        timestamp
        hash
      }
      transaction_version
    }
  }
`;

export async function backfillBadgeTimestamps(supabase: SupabaseClient) {
  if (!MODULE_ADDR) throw new Error('MODULE_ADDRESS not configured');

  console.log(`[Backfill] Indexing events for ${MODULE_ADDR}...`);

  const eventType = `${MODULE_ADDR}::badges::BadgeCreated`;

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_BADGE_EVENTS,
      variables: { moduleAddr: eventType }
    })
  });

  const json: any = await response.json();
  const events = json.data?.events || [];
  const txs = json.data?.account_transactions || [];

  console.log(`[Backfill] Found ${events.length} events and ${txs.length} create transactions.`);

  const timestampMap = new Map();
  txs.forEach((tx: any) => {
    timestampMap.set(tx.transaction_version, tx.user_transaction.timestamp);
  });

  for (const event of events) {
    const badgeId = event.data?.badge_id || event.data?.id;
    const timestamp = timestampMap.get(event.transaction_version);

    if (badgeId && timestamp) {
      console.log(`[Backfill] Updating badge ${badgeId} with timestamp ${timestamp}`);
      const { error } = await supabase
        .from('badge_definitions')
        .update({ 
          created_at: timestamp,
          updated_at: timestamp 
        })
        .eq('on_chain_badge_id', badgeId);

      if (error) console.error(`[Backfill] Failed to update badge ${badgeId}:`, error.message);
    }
  }

  console.log('[Backfill] Complete.');
}
