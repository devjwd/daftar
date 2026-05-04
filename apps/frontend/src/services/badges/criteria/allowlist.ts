/**
 * Allowlist Criteria Evaluator
 * 
 * Checks if user's address is in a predefined allowlist.
 */

export const meta = {
  type: 'allowlist',
  name: 'Allowlist',
  description: 'Requires the user address to be on an allow list',
  icon: '📋',
};

/**
 * @param {string} address - User wallet address
 * @param {object} params  - { addresses: string } (newline-separated)
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const { addresses = '' } = params || {};

  const normalizedUser = String(address).trim().toLowerCase();
  if (!normalizedUser) {
    return { eligible: false, current: 0, required: 1, progress: 0, label: 'No address provided' };
  }

  const allowlist = String(addresses)
    .split(/[\n,;]+/)
    .map(a => a.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    return { eligible: false, current: 0, required: 1, progress: 0, label: 'Empty allowlist' };
  }

  const found = allowlist.includes(normalizedUser);

  return {
    eligible: found,
    current: found ? 1 : 0,
    required: 1,
    progress: found ? 100 : 0,
    label: found ? 'Address is allowlisted' : 'Address is not allowlisted',
  };
}
