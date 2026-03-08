import { ACTIVITY_BADGE_TIERS } from '../../config/badges.js';
import { checkAccountExists as _checkAccountExists } from '../indexer.js';

// allow injection for testing
let checkAccountExists = _checkAccountExists;
export function __setIndexer(i) {
  if (i && typeof i.checkAccountExists === 'function') {
    checkAccountExists = i.checkAccountExists;
  }
}

/**
 * Returns a list of award objects for the supplied address.
 * Each award is { badgeId, extra } where extra may include metadata.
 */
export async function check(address) {
  if (!address) return [];

  const { txCount } = await checkAccountExists(address);
  const awards = [];
  ACTIVITY_BADGE_TIERS.forEach((tier) => {
    if (txCount >= tier.count) {
      // badgeId should match on-chain definition or backend record
      const badgeId = tier.name.toLowerCase().replace(/\s+/g, '-');
      awards.push({ badgeId, extra: { txCount } });
    }
  });
  return awards;
}

export default { check };
