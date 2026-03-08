/**
 * DEX Volume Criteria Evaluator
 *
 * Checks whether user has reached a minimum traded volume on a DEX protocol.
 */
import { getUserProtocolInteractions, DEFI_PROTOCOLS } from '../../defiIndexer.js';

export const meta = {
  type: 'dex_volume',
  name: 'DEX Volume',
  description: 'Requires minimum swap/trade volume on a specific DEX protocol',
  icon: '📊',
};

function toNumber(value) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAmount(raw, decimals) {
  const amount = toNumber(raw);
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 8;
  if (d <= 0) return amount;
  return amount / Math.pow(10, d);
}

function isDexLike(type = '') {
  const t = String(type).toLowerCase();
  return t.includes('swap') || t.includes('trade') || t.includes('router') || t.includes('clmm');
}

/**
 * @param {string} address
 * @param {{ protocolKey: string, minVolume: number, decimals?: number }} params
 */
export async function evaluate(address, params = {}) {
  const protocolKey = String(params.protocolKey || '').trim();
  const minVolume = Math.max(0, Number(params.minVolume || 0));
  const decimals = Number(params.decimals ?? 8);

  if (!protocolKey) {
    return { eligible: false, current: 0, required: minVolume || 1, progress: 0, label: 'Protocol not specified', error: 'protocolKey required' };
  }

  const protocol = DEFI_PROTOCOLS[protocolKey];
  if (!protocol?.address) {
    return { eligible: false, current: 0, required: minVolume || 1, progress: 0, label: `Unknown protocol: ${protocolKey}`, error: 'invalid protocolKey' };
  }

  try {
    const txs = await getUserProtocolInteractions(address);
    const protocolAddress = String(protocol.address).toLowerCase();

    let volume = 0;
    for (const tx of txs || []) {
      for (const activity of tx.fungible_asset_activities || []) {
        const assetType = String(activity.asset_type || '').toLowerCase();
        if (!assetType.includes(protocolAddress)) continue;
        if (!isDexLike(activity.type)) continue;

        volume += Math.abs(normalizeAmount(activity.amount, decimals));
      }
    }

    const required = Math.max(0, minVolume);
    const eligible = volume >= required;
    const progress = required > 0 ? Math.min(100, Math.round((volume / required) * 100)) : 100;

    return {
      eligible,
      current: volume,
      required,
      progress,
      label: eligible
        ? `Volume ${volume.toFixed(4)} on ${protocol.name}`
        : `${volume.toFixed(4)} / ${required} volume on ${protocol.name}`,
    };
  } catch (error) {
    console.warn('[criteria:dex_volume] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: minVolume || 1, progress: 0, label: 'Check failed', error: error.message };
  }
}
