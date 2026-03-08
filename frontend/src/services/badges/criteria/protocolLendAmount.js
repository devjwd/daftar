/**
 * Protocol Lend Amount Criteria Evaluator
 *
 * Checks whether user has supplied/lent at least a target amount on a protocol.
 */
import { getUserProtocolInteractions, DEFI_PROTOCOLS } from '../../defiIndexer.js';

export const meta = {
  type: 'protocol_lend_amount',
  name: 'Protocol Lend Amount',
  description: 'Requires lending/supplying a minimum amount on a specific protocol',
  icon: '🏦',
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

function isLendLike(type = '') {
  const t = String(type).toLowerCase();
  return t.includes('deposit') || t.includes('supply') || t.includes('lend') || t.includes('stake');
}

/**
 * @param {string} address
 * @param {{ protocolKey: string, minAmount: number, decimals?: number }} params
 */
export async function evaluate(address, params = {}) {
  const protocolKey = String(params.protocolKey || '').trim();
  const minAmount = toNumber(params.minAmount);
  const decimals = Number(params.decimals ?? 8);

  if (!protocolKey) {
    return { eligible: false, current: 0, required: minAmount || 1, progress: 0, label: 'Protocol not specified', error: 'protocolKey required' };
  }

  const protocol = DEFI_PROTOCOLS[protocolKey];
  if (!protocol?.address) {
    return { eligible: false, current: 0, required: minAmount || 1, progress: 0, label: `Unknown protocol: ${protocolKey}`, error: 'invalid protocolKey' };
  }

  try {
    const txs = await getUserProtocolInteractions(address);
    const protocolAddress = String(protocol.address).toLowerCase();

    let lentAmount = 0;
    for (const tx of txs || []) {
      for (const activity of tx.fungible_asset_activities || []) {
        const assetType = String(activity.asset_type || '').toLowerCase();
        if (!assetType.includes(protocolAddress)) continue;
        if (!isLendLike(activity.type)) continue;

        lentAmount += normalizeAmount(activity.amount, decimals);
      }
    }

    const required = Math.max(0, minAmount);
    const eligible = lentAmount >= required;
    const progress = required > 0 ? Math.min(100, Math.round((lentAmount / required) * 100)) : 100;

    return {
      eligible,
      current: lentAmount,
      required,
      progress,
      label: eligible
        ? `Lent ${lentAmount.toFixed(4)} on ${protocol.name}`
        : `Lent ${lentAmount.toFixed(4)} / ${required} on ${protocol.name}`,
    };
  } catch (error) {
    console.warn('[criteria:protocol_lend_amount] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: minAmount || 1, progress: 0, label: 'Check failed', error: error.message };
  }
}
