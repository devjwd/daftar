import { checkAccountExists } from '../indexerClient.js';

export async function check(address, params = {}) {
  if (!address) return [];

  const { txCount } = await checkAccountExists(address);
  const minTx = Number(params.min ?? params.count ?? 1);
  if (txCount < minTx) return [];

  return [{ badgeId: params.badgeId || 'first-step', extra: { txCount } }];
}

export default { check };
