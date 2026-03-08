import { getWalletAge as _getWalletAge } from '../indexer.js';

let getWalletAge = _getWalletAge;
export function __setIndexer(i) {
  if (i && typeof i.getWalletAge === 'function') {
    getWalletAge = i.getWalletAge;
  }
}
import { LONGEVITY_BADGE_TIERS } from '../../config/badges.js';

export async function check(address) {
  if (!address) return [];

  const ageData = await getWalletAge(address);
  const days = ageData && ageData.firstTxTimestamp ?
    Math.floor((Date.now() - new Date(ageData.firstTxTimestamp)) / (1000 * 60 * 60 * 24)) :
    0;

  const awards = [];
  LONGEVITY_BADGE_TIERS.forEach((tier) => {
    if (days >= tier.days) {
      const badgeId = tier.name.toLowerCase().replace(/\s+/g, '-');
      awards.push({ badgeId, extra: { days } });
    }
  });
  return awards;
}

export default { check };
