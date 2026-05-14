import fetch from 'node-fetch';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';

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
