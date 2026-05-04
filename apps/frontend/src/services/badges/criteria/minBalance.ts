/**
 * Minimum Balance Criteria Evaluator
 * 
 * Checks if user holds at least a minimum amount of a specific coin.
 */

export const meta = {
  type: 'min_balance',
  name: 'Minimum Balance',
  description: 'Requires holding a minimum balance of a specific token',
  icon: '💰',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { coinType: string, minAmount: number, decimals?: number }
 * @param {object} context - { client?: Aptos }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params, context = {}) {
  const { coinType, minAmount = 1, decimals = 8 } = params || {};
  const required = Number(minAmount) || 1;

  if (!coinType) {
    return { eligible: false, current: 0, required, progress: 0, label: 'No coin type specified', error: 'coinType required' };
  }

  try {
    const { client } = context;
    let balance = 0;

    if (client) {
      // Use on-chain view function
      try {
        const result = await client.view({
          payload: {
            function: '0x1::coin::balance',
            typeArguments: [coinType],
            functionArguments: [address],
          },
        });
        const rawBalance = Number(result?.[0]) || 0;
        balance = rawBalance / Math.pow(10, Number(decimals) || 8);
      } catch {
        // Account may not have this coin registered
        balance = 0;
      }
    }

    return {
      eligible: balance >= required,
      current: Math.round(balance * 100) / 100,
      required,
      progress: required > 0 ? Math.min(100, Math.round((balance / required) * 100)) : 100,
      label: `${balance.toFixed(2)} / ${required} tokens`,
    };
  } catch (error) {
    console.warn('[criteria:min_balance] evaluation failed:', error.message);
    return { eligible: false, current: 0, required, progress: 0, label: `0 / ${required} tokens`, error: error.message };
  }
}
