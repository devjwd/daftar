import { BADGE_RULES } from './constants.js';
import transactionCountAdapter from './transactionCount.js';
import longevityAdapter from './longevity.js';
import minBalanceAdapter from './minBalance.js';

const ALL_ADAPTERS = [transactionCountAdapter, longevityAdapter, minBalanceAdapter];

export async function runAdaptersForAddress(address, badgeConfigs = [], ctx = {}) {
  if (!address) return [];

  const awards = [];
  for (const config of badgeConfigs) {
    try {
      const params = { badgeId: config.badgeId, ...(config.params || {}) };
      let result = null;

      switch (config.rule) {
        case BADGE_RULES.TRANSACTION_COUNT:
          result = await transactionCountAdapter.check(address, params, ctx);
          break;
        case BADGE_RULES.DAYS_ONCHAIN:
          result = await longevityAdapter.check(address, params, ctx);
          break;
        case BADGE_RULES.MIN_BALANCE:
          result = await minBalanceAdapter.check(address, params, ctx);
          break;
        default:
          break;
      }

      if (Array.isArray(result)) awards.push(...result.filter(Boolean));
      else if (result) awards.push(result);
    } catch (err) {
      console.warn('[badgeAdapters] adapter failed', config?.badgeId, err);
    }
  }

  return awards;
}

export { ALL_ADAPTERS, BADGE_RULES };

export default {
  ALL_ADAPTERS,
  BADGE_RULES,
  runAdaptersForAddress,
};
