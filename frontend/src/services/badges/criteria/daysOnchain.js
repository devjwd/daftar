/**
 * Days On-chain Criteria Evaluator
 * 
 * Checks if user has been active on-chain for at least N days.
 */
import { getWalletAge } from '../../indexer.js';

export const meta = {
  type: 'days_onchain',
  name: 'Days On-chain',
  description: 'Requires a minimum number of days since first transaction',
  icon: '📅',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { min: number }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const min = Number(params?.min) || 7;

  try {
    const ageData = await getWalletAge(address);
    let days = 0;

    if (ageData?.firstTxTimestamp) {
      const firstTxMs = typeof ageData.firstTxTimestamp === 'number'
        ? (ageData.firstTxTimestamp < 1e12 ? ageData.firstTxTimestamp * 1000 : ageData.firstTxTimestamp)
        : Date.parse(ageData.firstTxTimestamp);

      if (!Number.isNaN(firstTxMs) && firstTxMs > 0) {
        days = Math.floor((Date.now() - firstTxMs) / (1000 * 60 * 60 * 24));
      }
    }

    return {
      eligible: days >= min,
      current: Math.max(0, days),
      required: min,
      progress: min > 0 ? Math.min(100, Math.round((days / min) * 100)) : 100,
      label: `${Math.max(0, days)} / ${min} days`,
    };
  } catch (error) {
    console.warn('[criteria:days_onchain] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: min, progress: 0, label: `0 / ${min} days`, error: error.message };
  }
}
