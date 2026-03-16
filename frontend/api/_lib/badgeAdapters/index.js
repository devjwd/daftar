import { BADGE_RULES } from './constants.js';
import transactionCountAdapter from './transactionCount.js';
import longevityAdapter from './longevity.js';
import minBalanceAdapter from './minBalance.js';
import dappUsageAdapter from './dappUsage.js';
import protocolCountAdapter from './protocolCount.js';

export async function runAdaptersForAddress(address, badgeConfigs = []) {
  if (!address) return [];

  const awards = [];
  for (const config of badgeConfigs) {
    try {
      const params = { badgeId: config.badgeId, ...(config.params || {}) };
      let result = null;

      switch (config.rule) {
        case BADGE_RULES.TX_COUNT:
        case BADGE_RULES.TRANSACTION_COUNT:
          result = await transactionCountAdapter.check(address, params);
          break;
        case BADGE_RULES.ACTIVE_DAYS:
        case BADGE_RULES.DAYS_ONCHAIN:
          result = await longevityAdapter.check(address, params);
          break;
        case BADGE_RULES.MIN_BALANCE:
          result = await minBalanceAdapter.check(address, params);
          break;
        case BADGE_RULES.DAPP_USAGE:
          result = await dappUsageAdapter.check(address, params);
          break;
        case BADGE_RULES.PROTOCOL_COUNT:
          result = await protocolCountAdapter.check(address, params);
          break;
        // ALLOWLIST and ATTESTATION are handled by manual admin action
        case BADGE_RULES.ALLOWLIST:
        case BADGE_RULES.ATTESTATION:
        case BADGE_RULES.HOLDING_PERIOD:
        case BADGE_RULES.NFT_HOLDER:
        case BADGE_RULES.COMPOSITE:
          // These require admin attestation
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

export { BADGE_RULES };
