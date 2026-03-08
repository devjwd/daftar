import transactionCountAdapter from './transactionCount.js';
import longevityAdapter from './longevity.js';
import minBalanceAdapter from './minBalance.js';
import { BADGE_RULES } from '../../config/badges.js';

const ALL_ADAPTERS = [transactionCountAdapter, longevityAdapter, minBalanceAdapter];

// badgeConfigs: [{ badgeId, rule, params }]
export async function runAdaptersForAddress(address, badgeConfigs = [], ctx = {}) {
  if (!address) return [];
  const awards = [];

  for (const bc of badgeConfigs) {
    try {
      const params = { badgeId: bc.badgeId, ...(bc.params || {}) };
      let result = null;
      switch (bc.rule) {
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
          // unknown rule; ignore
          break;
      }
      if (result) {
        if (Array.isArray(result)) {
          awards.push(...result.filter(Boolean));
        } else {
          awards.push(result);
        }
      }
    } catch (e) {
      console.warn('error running adapter for', bc.badgeId, e);
    }
  }

  return awards;
}

export { ALL_ADAPTERS };

export default {
  ALL_ADAPTERS,
  runAdaptersForAddress,
};
