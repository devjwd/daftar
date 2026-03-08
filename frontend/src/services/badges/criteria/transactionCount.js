/**
 * Transaction Count Criteria Evaluator
 * 
 * Checks if user has executed at least N transactions on Movement.
 */
import { checkAccountExists } from '../../indexer.js';

export const meta = {
  type: 'transaction_count',
  name: 'Transaction Count',
  description: 'Requires a minimum number of on-chain transactions',
  icon: '📊',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { min: number }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const min = Number(params?.min) || 1;

  try {
    const accountData = await checkAccountExists(address);
    const txCount = Number(accountData?.txCount) || 0;

    return {
      eligible: txCount >= min,
      current: txCount,
      required: min,
      progress: min > 0 ? Math.min(100, Math.round((txCount / min) * 100)) : 100,
      label: `${txCount} / ${min} transactions`,
    };
  } catch (error) {
    console.warn('[criteria:transaction_count] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: min, progress: 0, label: `0 / ${min} transactions`, error: error.message };
  }
}
