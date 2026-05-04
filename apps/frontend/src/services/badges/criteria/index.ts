/**
 * Criteria Registry
 * 
 * Central registry of all available criteria evaluators.
 * To add a new criterion: create a file in criteria/ with `meta` and `evaluate`,
 * then import and register it here.
 */
import * as transactionCount from './transactionCount';
import * as daysOnchain from './daysOnchain';
import * as minBalance from './minBalance';
import * as tokenHolder from './tokenHolder';
import * as protocolUsage from './protocolUsage';
import * as protocolCount from './protocolCount';
import * as protocolLendAmount from './protocolLendAmount';
import * as dexTxCount from './dexTxCount';
import * as dexVolume from './dexVolume';
import * as nftHolder from './nftHolder';
import * as allowlist from './allowlist';
import * as defiTvl from './defiTvl';

const ALL_CRITERIA = [
  transactionCount,
  daysOnchain,
  minBalance,
  tokenHolder,
  protocolUsage,
  protocolCount,
  protocolLendAmount,
  dexTxCount,
  dexVolume,
  nftHolder,
  allowlist,
  defiTvl,
];

// Build a lookup map: type → { meta, evaluate }
const registry = new Map();
for (const criterion of ALL_CRITERIA) {
  if (criterion.meta?.type) {
    registry.set(criterion.meta.type, criterion);
  }
}

/**
 * Get a criteria evaluator by type.
 * @param {string} type - The criteria type key
 * @returns {{ meta: object, evaluate: function } | null}
 */
export function getCriterion(type) {
  return registry.get(type) || null;
}

/**
 * Get all registered criteria evaluators.
 * @returns {Array<{ meta: object, evaluate: function }>}
 */
export function getAllCriteria() {
  return ALL_CRITERIA;
}

/**
 * Get all criteria metadata (for UI dropdowns etc).
 * @returns {Array<{ type: string, name: string, description: string, icon: string }>}
 */
export function getCriteriaMetadata() {
  return ALL_CRITERIA.map(c => ({ ...c.meta }));
}

/**
 * Check if a criteria type is registered.
 * @param {string} type
 * @returns {boolean}
 */
export function hasCriterion(type) {
  return registry.has(type);
}

export default { getCriterion, getAllCriteria, getCriteriaMetadata, hasCriterion };
