import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from '../config/index.ts';

/**
 * Runs the backend crawler to discover new exchange deposit addresses.
 * Scans transactions sent to known Exchange Hot Wallets and logs the senders.
 */
export async function runExchangeCrawler(supabaseAdmin: SupabaseClient, targetExchangeId?: string) {
  console.log('[Crawler] Starting exchange deposit address crawler...');

  try {
    let query = supabaseAdmin.from('tracked_entities').select('*').eq('category', 'Exchange');
    if (targetExchangeId && targetExchangeId !== 'all') {
      query = query.eq('id', targetExchangeId);
    }

    const { data: exchanges, error: exchangeErr } = await query;
    if (exchangeErr) throw exchangeErr;

    if (!exchanges || exchanges.length === 0) {
      console.log('[Crawler] No exchange entities found.');
      return;
    }

    const knownAddresses = new Set(exchanges.map(e => e.address.toLowerCase()));

    for (const exchange of exchanges) {
      console.log(`[Crawler] Crawling ${exchange.name}...`);
      
      const crawlStateKey = `crawl_state_${exchange.id}`;
      
      // Fetch checkpoint
      const { data: configData } = await supabaseAdmin
        .from('system_config')
        .select('value')
        .eq('key', crawlStateKey)
        .single();
        
      const lastCrawlVersion = configData?.value ? BigInt(configData.value) : BigInt(-1);
      let highestSeenVersion: bigint | null = null;
      
      let ltVersion: string | null = "9223372036854775807";
      let hasMore = true;
      let checkedTxs = 0;
      let totalFound = 0;
      const allDiscoveredForExchange = [];

      while (hasMore) {
        const response = await fetch(CONFIG.MOVEMENT.INDEXER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query Crawl($addr: String!, $lt: bigint) {
              account_transactions(where: { account_address: { _eq: $addr }, transaction_version: { _lt: $lt } }, order_by: { transaction_version: desc }, limit: 50) {
                transaction_version
                user_transaction { 
                  sender 
                  entry_function_id_str
                }
              }
            }`,
            variables: { addr: exchange.address, lt: ltVersion }
          })
        });

        if (!response.ok) {
           console.error(`[Crawler] Indexer request failed with status: ${response.status}`);
           break;
        }

        const json = await response.json() as any;
        const txs = json.data?.account_transactions || [];
        
        if (txs.length === 0) {
          hasMore = false;
          break;
        }

        checkedTxs += txs.length;

        for (const tx of txs) {
          const currentVersion = BigInt(tx.transaction_version);
          
          if (highestSeenVersion === null || currentVersion > highestSeenVersion) {
            highestSeenVersion = currentVersion;
          }

          if (currentVersion <= lastCrawlVersion) {
            hasMore = false;
            break;
          }

          const sender = tx.user_transaction?.sender?.toLowerCase();
          const entryFunction = tx.user_transaction?.entry_function_id_str?.toLowerCase() || '';

          // Heuristic Filter: A genuine exchange deposit is typically a direct transfer.
          // If the transaction calls a complex smart contract function (e.g. swap, route, execute),
          // it's likely a DeFi router or multi-sig, NOT an individual user's deposit address.
          const isDirectTransfer = entryFunction.includes('transfer');

          if (sender && sender !== exchange.address.toLowerCase() && !knownAddresses.has(sender) && isDirectTransfer) {
            allDiscoveredForExchange.push({
              address: sender,
              entity_id: exchange.id,
              label_name: `${exchange.name} Deposit Address`,
              discovery_method: 'browser_crawl'
            });
            knownAddresses.add(sender);
            totalFound++;
          }
        }

        if (!hasMore) break;

        ltVersion = txs[txs.length - 1].transaction_version;
        if (txs.length < 50) hasMore = false;
        
        // Anti-rate-limit sleep
        await new Promise(r => setTimeout(r, 200));
      }

      console.log(`[Crawler] Finished ${exchange.name}. Checked ${checkedTxs} txs, found ${totalFound} new addresses.`);

      // Update checkpoint globally
      if (highestSeenVersion !== null) {
        await supabaseAdmin.from('system_config').upsert({
          key: crawlStateKey,
          value: highestSeenVersion.toString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      }

      // Bulk upsert discovered labels
      if (allDiscoveredForExchange.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < allDiscoveredForExchange.length; i += chunkSize) {
          const chunk = allDiscoveredForExchange.slice(i, i + chunkSize);
          const { error } = await supabaseAdmin.from('address_labels').upsert(chunk, { onConflict: 'address' });
          if (error) {
            console.error(`[Crawler] Failed to upsert labels chunk for ${exchange.name}:`, error);
          }
        }
        console.log(`[Crawler] Successfully stored ${totalFound} labels for ${exchange.name}.`);
      }
    }
    
    console.log('[Crawler] Crawl completed successfully.');
  } catch (err) {
    console.error('[Crawler] Fatal error during crawl:', err);
  }
}
