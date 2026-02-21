import { BADGE_MODULE_ADDRESS } from "./network";

export const BADGE_MODULE_NAME = "badges";

// Fallback: use module address from network config
export const getModuleAddress = () => BADGE_MODULE_ADDRESS;

// Badge rarity tiers with colors and properties
export const BADGE_RARITY = {
  COMMON: {
    level: 1,
    name: 'Common',
    color: '#10b981',
    borderColor: '#059669',
    bgGradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)',
    glowColor: 'rgba(16, 185, 129, 0.3)',
  },
  UNCOMMON: {
    level: 2,
    name: 'Uncommon',
    color: '#3b82f6',
    borderColor: '#1e40af',
    bgGradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)',
    glowColor: 'rgba(59, 130, 246, 0.3)',
  },
  RARE: {
    level: 3,
    name: 'Rare',
    color: '#8b5cf6',
    borderColor: '#6d28d9',
    bgGradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)',
    glowColor: 'rgba(139, 92, 246, 0.3)',
  },
  EPIC: {
    level: 4,
    name: 'Epic',
    color: '#f59e0b',
    borderColor: '#d97706',
    bgGradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)',
    glowColor: 'rgba(245, 158, 11, 0.3)',
  },
  LEGENDARY: {
    level: 5,
    name: 'Legendary',
    color: '#fbbf24',
    borderColor: '#b45309',
    bgGradient: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.08) 100%)',
    glowColor: 'rgba(251, 191, 36, 0.5)',
  },
};

export const BADGE_RULES = {
  ALLOWLIST: 1,
  MIN_BALANCE: 2,
  OFFCHAIN_ALLOWLIST: 3,
  TRANSACTION_COUNT: 4,
  DAYS_ONCHAIN: 5,
};

export const BADGE_CATEGORIES = {
  MANUAL: {
    id: 'manual',
    name: 'Manual Badges',
    description: 'Custom badges with allowlist or balance requirements',
    rules: [BADGE_RULES.ALLOWLIST, BADGE_RULES.MIN_BALANCE, BADGE_RULES.OFFCHAIN_ALLOWLIST],
  },
  ACTIVITY: {
    id: 'activity',
    name: 'Activity Badges',
    description: 'Badges based on transaction counts',
    rules: [BADGE_RULES.TRANSACTION_COUNT],
  },
  LONGEVITY: {
    id: 'longevity',
    name: 'Longevity Badges',
    description: 'Badges based on time spent onchain',
    rules: [BADGE_RULES.DAYS_ONCHAIN],
  },
};

// Predefined activity badge tiers with rarity and XP
export const ACTIVITY_BADGE_TIERS = [
  { count: 1, name: 'First Step', emoji: '👣', description: 'Made first transaction', rarity: 'COMMON', xp: 10, percentileThreshold: 95 },
  { count: 10, name: 'Active Trader', emoji: '📈', description: '10+ transactions', rarity: 'UNCOMMON', xp: 25, percentileThreshold: 70 },
  { count: 25, name: 'Committed User', emoji: '💪', description: '25+ transactions', rarity: 'RARE', xp: 40, percentileThreshold: 40 },
  { count: 50, name: 'Power User', emoji: '⚡', description: '50+ transactions', rarity: 'EPIC', xp: 60, percentileThreshold: 15 },
  { count: 100, name: 'Trade Master', emoji: '🎯', description: '100+ transactions', rarity: 'EPIC', xp: 75, percentileThreshold: 5 },
  { count: 250, name: 'Legendary', emoji: '👑', description: '250+ transactions', rarity: 'LEGENDARY', xp: 100, percentileThreshold: 1 },
];

// Predefined longevity badge tiers with rarity and XP
export const LONGEVITY_BADGE_TIERS = [
  { days: 7, name: '7-Day Pioneer', emoji: '🌟', description: '7 days onchain', rarity: 'COMMON', xp: 10, percentileThreshold: 90 },
  { days: 30, name: 'Monthly Member', emoji: '📅', description: '30 days onchain', rarity: 'UNCOMMON', xp: 25, percentileThreshold: 60 },
  { days: 100, name: 'Century Veteran', emoji: '💯', description: '100 days onchain', rarity: 'RARE', xp: 50, percentileThreshold: 30 },
  { days: 200, name: '200-Day Champion', emoji: '🏆', description: '200 days onchain', rarity: 'EPIC', xp: 70, percentileThreshold: 10 },
  { days: 365, name: 'Annual Legend', emoji: '🎖️', description: '365 days onchain', rarity: 'EPIC', xp: 85, percentileThreshold: 3 },
  { days: 730, name: 'Two-Year Titan', emoji: '🚀', description: '730 days onchain', rarity: 'LEGENDARY', xp: 120, percentileThreshold: 0.5 },
];

// Badge chains - unlock prerequisites
export const BADGE_CHAINS = {
  activity: [
    { tier: 0, unlocks: 1 }, // First Step unlocks Active Trader
    { tier: 1, unlocks: 2 },
    { tier: 2, unlocks: 3 },
    { tier: 3, unlocks: 4 },
    { tier: 4, unlocks: 5 },
  ],
  longevity: [
    { tier: 0, unlocks: 1 },
    { tier: 1, unlocks: 2 },
    { tier: 2, unlocks: 3 },
    { tier: 3, unlocks: 4 },
    { tier: 4, unlocks: 5 },
  ],
};

export const getBadgeModuleAddress = () => getModuleAddress();

export const getBadgeFunction = (functionName) => {
  const address = getBadgeModuleAddress();
  if (!address) return null;
  return `${address}::${BADGE_MODULE_NAME}::${functionName}`;
};

export const getRuleLabel = (ruleType) => {
  const rules = {
    [BADGE_RULES.ALLOWLIST]: 'Allowlist',
    [BADGE_RULES.MIN_BALANCE]: 'Minimum Balance',
    [BADGE_RULES.OFFCHAIN_ALLOWLIST]: 'Off-chain Allowlist',
    [BADGE_RULES.TRANSACTION_COUNT]: 'Transaction Count',
    [BADGE_RULES.DAYS_ONCHAIN]: 'Days Onchain',
  };
  return rules[ruleType] || 'Unknown';
};

/**
 * Get rarity info for a badge
 */
export const getRarityInfo = (rarity) => {
  return BADGE_RARITY[rarity] || BADGE_RARITY.COMMON;
};

/**
 * Calculate total XP from badge collection
 */
export const calculateTotalXP = (badges) => {
  return badges.reduce((total, badge) => {
    const rarity = BADGE_RARITY[badge.rarity] || BADGE_RARITY.COMMON;
    const xpValue = badge.xp || (rarity.level * 10);
    return total + xpValue;
  }, 0);
};

/**
 * Get user level from XP
 */
export const getLevelFromXP = (xp) => {
  const xpPerLevel = 100;
  return Math.floor(xp / xpPerLevel) + 1;
};

/**
 * Get XP needed for next level
 */
export const getXPForLevel = (level) => {
  return (level - 1) * 100;
};

/**
 * Get next level XP requirement
 */
export const getNextLevelXP = (xp) => {
  const currentLevel = getLevelFromXP(xp);
  return getXPForLevel(currentLevel + 1);
};
