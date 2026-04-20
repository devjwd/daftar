/**
 * DEX Transaction Count Criteria Evaluator
 *
 * Checks whether user has performed at least N DEX interactions on a protocol.
 */
import { getUserProtocolInteractions, DEFI_PROTOCOLS } from '../../defiIndexer.js';

export const meta = {
  type: 'dex_tx_count',
  name: 'DEX Transaction Count',
  description: 'Requires a minimum number of DEX transactions on a specific protocol',
  icon: '🔁',
};

function isDexLike(type = '') {
  const t = String(type).toLowerCase();
  return t.includes('swap') || t.includes('trade') || t.includes('router') || t.includes('clmm');
}

/**
 * @param {string} address
 * @param {{ protocolKey: string, minTxCount: number }} params
 */
export async function evaluate(address, params = {}) {
  const protocolKey = String(params.protocolKey || '').trim();
  const minTxCount = Math.max(1, Number(params.minTxCount || 1));

  if (!protocolKey) {
    return { eligible: false, current: 0, required: minTxCount, progress: 0, label: 'Protocol not specified', error: 'protocolKey required' };
  }

  const protocol = DEFI_PROTOCOLS[protocolKey];
  if (!protocol?.address) {
    return { eligible: false, current: 0, required: minTxCount, progress: 0, label: `Unknown protocol: ${protocolKey}`, error: 'invalid protocolKey' };
  }

  try {
    const txs = await getUserProtocolInteractions(address);
    const protocolAddress = String(protocol.address).toLowerCase();

    let count = 0;
    for (const tx of txs || []) {
      let matchedTx = false;
      for (const activity of tx.fungible_asset_activities || []) {
        const assetType = String(activity.asset_type || '').toLowerCase();
        if (!assetType.includes(protocolAddress)) continue;
        if (!isDexLike(activity.type)) continue;
        matchedTx = true;
        break;
      }
      if (matchedTx) count += 1;
    }

    const eligible = count >= minTxCount;
    const progress = Math.min(100, Math.round((count / minTxCount) * 100));

    return {
      eligible,
      current: count,
      required: minTxCount,
      progress,
      label: eligible
        ? `${count} DEX tx on ${protocol.name}`
        : `${count} / ${minTxCount} DEX tx on ${protocol.name}`,
    };
  } catch (error) {
    console.warn('[criteria:dex_tx_count] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: minTxCount, progress: 0, label: 'Check failed', error: error.message };
  }
}
