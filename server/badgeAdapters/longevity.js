import { getWalletAge } from '../indexerClient.js';

export async function check(address, params = {}) {
  if (!address) return [];

  const age = await getWalletAge(address);
  const days = age?.firstTxTimestamp
    ? Math.floor((Date.now() - new Date(age.firstTxTimestamp).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const minDays = Number(params.min ?? params.days ?? 1);
  if (days < minDays) return [];

  const badgeId = params.badgeId || `wallet-${minDays}-days`;
  return [{ badgeId, extra: { days } }];
}

export default { check };
