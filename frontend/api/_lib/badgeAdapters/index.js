import { BADGE_RULES } from './constants.js';
import transactionCountAdapter from './transactionCount.js';
import longevityAdapter from './longevity.js';
import minBalanceAdapter from './minBalance.js';

export async function runAdaptersForAddress(address, badgeConfigs = []) {
  if (!address) return [];

  const awards = [];
  for (const config of badgeConfigs) {
    try {
      const params = { badgeId: config.badgeId, ...(config.params || {}) };
      let result = null;

      switch (config.rule) {
        case BADGE_RULES.TRANSACTION_COUNT:
          result = await transactionCountAdapter.check(address, params);
          break;
        case BADGE_RULES.DAYS_ONCHAIN:
          result = await longevityAdapter.check(address, params);
          break;
        case BADGE_RULES.MIN_BALANCE:
          result = await minBalanceAdapter.check(address, params);
          break;
        default:
          break;
      }

      if (Array.isArray(result)) awards.push(...result.filter(Boolean));
      else if (result) awards.push(result);
    } catch (err) {
      console.warn('[badgeAdapters] adapter failed', config?.badgeId, err.message);
    }
  }

  return awards;
}
