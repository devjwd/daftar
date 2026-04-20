import { getUserTokenBalances as _getUserTokenBalances } from '../indexer.js';

let getUserTokenBalances = _getUserTokenBalances;
export function __setIndexer(i) {
  if (i && typeof i.getUserTokenBalances === 'function') {
    getUserTokenBalances = i.getUserTokenBalances;
  }
}

/**
 * rule: specify coinTypeStr and minimum balance in adapter config
 * example config object: { coinType: '0x1::aptos_coin::AptosCoin', minBalance: 100 }
 */
export async function check(address, client, rule) {
  if (!address || !rule) return [];

  const { coinType, minBalance } = rule;
  if (!coinType || minBalance == null) return [];

  const balances = await getUserTokenBalances(address);
  const matching = balances.find((b) => b.coinType === coinType);
  const amount = matching ? parseFloat(matching.amount) : 0;
  if (amount >= minBalance) {
    const badgeId = rule.badgeId || `${coinType.split('::').pop().toLowerCase()}-holder`;
    return [{ badgeId, extra: { amount } }];
  }
  return [];
}

export default { check };
