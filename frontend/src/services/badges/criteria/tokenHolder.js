/**
 * Token Holder Criteria Evaluator
 * 
 * Checks if user holds any amount (or min amount) of a specific token via indexer.
 */
import { getUserTokenBalances } from '../../indexer.js';

export const meta = {
  type: 'token_holder',
  name: 'Token Holder',
  description: 'Requires holding a specific token (by address)',
  icon: '🪙',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { tokenAddress: string, minAmount?: number }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const { tokenAddress, minAmount = 0 } = params || {};
  const required = Number(minAmount) || 0;

  if (!tokenAddress) {
    return { eligible: false, current: 0, required, progress: 0, label: 'No token address specified', error: 'tokenAddress required' };
  }

  try {
    const balances = await getUserTokenBalances(address);
    const normalizedTarget = String(tokenAddress).toLowerCase();

    const match = (balances || []).find(b => {
      const assetType = String(b.asset_type || b.coinType || '').toLowerCase();
      return assetType.includes(normalizedTarget);
    });

    const rawAmount = Number(match?.amount) || 0;
    const decimals = Number(match?.metadata?.decimals) || 8;
    const humanAmount = rawAmount / Math.pow(10, decimals);

    const eligible = required > 0 ? humanAmount >= required : rawAmount > 0;

    return {
      eligible,
      current: Math.round(humanAmount * 100) / 100,
      required: required || 0,
      progress: required > 0
        ? Math.min(100, Math.round((humanAmount / required) * 100))
        : (rawAmount > 0 ? 100 : 0),
      label: required > 0
        ? `${humanAmount.toFixed(2)} / ${required} tokens`
        : `Holds: ${rawAmount > 0 ? 'Yes' : 'No'}`,
    };
  } catch (error) {
    console.warn('[criteria:token_holder] evaluation failed:', error.message);
    return { eligible: false, current: 0, required, progress: 0, label: 'Check failed', error: error.message };
  }
}
