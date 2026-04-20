/**
 * Protocol Interaction Count Criteria Evaluator
 *
 * Checks whether user has interacted with at least N unique DeFi protocols/dApps.
 */
import { detectUserProtocols } from '../../defiIndexer.js';

export const meta = {
  type: 'protocol_count',
  name: 'Protocol Interaction Count',
  description: 'Requires interaction with a minimum number of unique DeFi protocols/dApps',
  icon: '🧩',
};

/**
 * @param {string} address
 * @param {{ minProtocols?: number }} params
 */
export async function evaluate(address, params = {}) {
  const minProtocols = Math.max(1, Number(params.minProtocols || 1));

  try {
    const detected = await detectUserProtocols(address);
    const uniqueCount = Array.isArray(detected) ? detected.length : 0;

    const eligible = uniqueCount >= minProtocols;
    const progress = Math.min(100, Math.round((uniqueCount / minProtocols) * 100));

    return {
      eligible,
      current: uniqueCount,
      required: minProtocols,
      progress,
      label: eligible
        ? `Interacted with ${uniqueCount} protocols`
        : `${uniqueCount} / ${minProtocols} protocols interacted`,
    };
  } catch (error) {
    console.warn('[criteria:protocol_count] evaluation failed:', error.message);
    return {
      eligible: false,
      current: 0,
      required: minProtocols,
      progress: 0,
      label: 'Check failed',
      error: error.message,
    };
  }
}
