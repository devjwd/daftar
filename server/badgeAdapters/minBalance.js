import { getUserTokenBalances } from '../indexerClient.js';

export async function check(address, params = {}) {
  if (!address) return [];

  const coinType = params.coinType;
  const minAmount = Number(params.minAmount ?? params.minBalance ?? 0);
  if (!coinType) return [];

  const balances = await getUserTokenBalances(address);
  const matching = balances.find((b) => b.asset_type === coinType || b.coinType === coinType);
  const rawAmount = Number(matching?.amount || 0);

  if (rawAmount < minAmount) return [];

  const badgeId = params.badgeId || `${coinType.split('::').pop().toLowerCase()}-holder`;
  return [{ badgeId, extra: { amount: rawAmount } }];
}

export default { check };
