/**
 * Protocol Usage Criteria Evaluator
 * 
 * Checks if user has interacted with a specific DeFi protocol.
 */
import { detectUserProtocols } from '../../defiIndexer.js';

export const meta = {
  type: 'protocol_usage',
  name: 'Protocol Usage',
  description: 'Requires interaction with a specific DeFi protocol',
  icon: '🏗️',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { protocolKey: string }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const { protocolKey } = params || {};

  if (!protocolKey) {
    return { eligible: false, current: 0, required: 1, progress: 0, label: 'No protocol specified', error: 'protocolKey required' };
  }

  try {
    const detectedProtocols = await detectUserProtocols(address);
    const found = (detectedProtocols || []).some(
      p => String(p.key).toLowerCase() === String(protocolKey).toLowerCase()
    );

    return {
      eligible: found,
      current: found ? 1 : 0,
      required: 1,
      progress: found ? 100 : 0,
      label: found ? `Used ${protocolKey}` : `Not used ${protocolKey}`,
    };
  } catch (error) {
    console.warn('[criteria:protocol_usage] evaluation failed:', error.message);
    return { eligible: false, current: 0, required: 1, progress: 0, label: 'Check failed', error: error.message };
  }
}
