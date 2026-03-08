/**
 * DeFi TVL Criteria Evaluator
 * 
 * Checks if user has a minimum total value locked across DeFi protocols.
 */
import { getDeFiTokenBalances } from '../../defiIndexer.js';

export const meta = {
  type: 'defi_tvl',
  name: 'DeFi TVL',
  description: 'Requires a minimum total value locked in DeFi protocols',
  icon: '🏦',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { minUsd: number }
 * @param {object} context - { priceMap?: object }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params, context = {}) {
  const { minUsd = 100 } = params || {};
  const required = Number(minUsd) || 100;
  const { priceMap = {} } = context;

  try {
    const defiBalances = await getDeFiTokenBalances(address);
    let totalUsd = 0;

    for (const balance of (defiBalances || [])) {
      const rawAmount = Number(balance.amount) || 0;
      const decimals = Number(balance.metadata?.decimals) || 8;
      const humanAmount = rawAmount / Math.pow(10, decimals);
      const assetType = String(balance.asset_type || '').toLowerCase();

      // Try to find price from context
      const price = priceMap[assetType] || 0;
      totalUsd += humanAmount * price;
    }

    // If we couldn't price anything, count the number of positions as a proxy
    const hasPositions = (defiBalances || []).length > 0;

    return {
      eligible: totalUsd >= required || (required === 0 && hasPositions),
      current: Math.round(totalUsd * 100) / 100,
      required,
      progress: required > 0 ? Math.min(100, Math.round((totalUsd / required) * 100)) : (hasPositions ? 100 : 0),
      label: `$${totalUsd.toFixed(2)} / $${required} TVL`,
    };
  } catch (error) {
    console.warn('[criteria:defi_tvl] evaluation failed:', error.message);
    return { eligible: false, current: 0, required, progress: 0, label: 'Check failed', error: error.message };
  }
}
