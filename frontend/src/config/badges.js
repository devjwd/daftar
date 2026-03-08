/**
 * Badge System Configuration
 * 
 * SBT (Soulbound Token) badge system for Movement Network.
 * Supports admin-defined badges with pluggable eligibility criteria
 * and real-time progress tracking.
 */
import { BADGE_MODULE_ADDRESS } from './network.js';

// ─── Module Constants ────────────────────────────────────────────────
export const BADGE_MODULE_NAME = 'badges';
export const BADGE_STORE_KEY = 'movement_badges_v2';
export const BADGE_AWARDS_KEY = 'movement_badge_awards_v2';

export const getModuleAddress = () => BADGE_MODULE_ADDRESS;
export const getBadgeModuleAddress = () => getModuleAddress();

export const getBadgeFunction = (functionName) => {
  const address = getBadgeModuleAddress();
  if (!address) return null;
  return `${address}::${BADGE_MODULE_NAME}::${functionName}`;
};

// ─── Criteria Types (pluggable) ──────────────────────────────────────
export const CRITERIA_TYPES = {
  TRANSACTION_COUNT: 'transaction_count',
  DAYS_ONCHAIN: 'days_onchain',
  MIN_BALANCE: 'min_balance',
  TOKEN_HOLDER: 'token_holder',
  PROTOCOL_USAGE: 'protocol_usage',
  PROTOCOL_COUNT: 'protocol_count',
  PROTOCOL_LEND_AMOUNT: 'protocol_lend_amount',
  DEX_TX_COUNT: 'dex_tx_count',
  DEX_VOLUME: 'dex_volume',
  NFT_HOLDER: 'nft_holder',
  ALLOWLIST: 'allowlist',
  DEFI_TVL: 'defi_tvl',
};

// Human-readable labels for each criteria type
export const CRITERIA_LABELS = {
  [CRITERIA_TYPES.TRANSACTION_COUNT]: 'Transaction Count',
  [CRITERIA_TYPES.DAYS_ONCHAIN]: 'Days On-chain',
  [CRITERIA_TYPES.MIN_BALANCE]: 'Minimum Balance',
  [CRITERIA_TYPES.TOKEN_HOLDER]: 'Token Holder',
  [CRITERIA_TYPES.PROTOCOL_USAGE]: 'Protocol Usage',
  [CRITERIA_TYPES.PROTOCOL_COUNT]: 'Protocol Interaction Count',
  [CRITERIA_TYPES.PROTOCOL_LEND_AMOUNT]: 'Protocol Lend Amount',
  [CRITERIA_TYPES.DEX_TX_COUNT]: 'DEX Transaction Count',
  [CRITERIA_TYPES.DEX_VOLUME]: 'DEX Volume',
  [CRITERIA_TYPES.NFT_HOLDER]: 'NFT Holder',
  [CRITERIA_TYPES.ALLOWLIST]: 'Allowlist',
  [CRITERIA_TYPES.DEFI_TVL]: 'DeFi TVL',
};

// Criteria parameter schemas (drives the admin form rendering)
export const CRITERIA_PARAM_SCHEMAS = {
  [CRITERIA_TYPES.TRANSACTION_COUNT]: {
    min: { type: 'number', label: 'Minimum Transactions', required: true, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.DAYS_ONCHAIN]: {
    min: { type: 'number', label: 'Minimum Days', required: true, default: 7, min: 1 },
  },
  [CRITERIA_TYPES.MIN_BALANCE]: {
    coinType: { type: 'text', label: 'Coin Type (full path)', required: true, placeholder: '0x1::aptos_coin::AptosCoin' },
    minAmount: { type: 'number', label: 'Minimum Amount (human-readable)', required: true, default: 1, min: 0 },
    decimals: { type: 'number', label: 'Token Decimals', required: false, default: 8, min: 0, max: 18 },
  },
  [CRITERIA_TYPES.TOKEN_HOLDER]: {
    tokenAddress: { type: 'text', label: 'Token Address', required: true, placeholder: '0x...' },
    minAmount: { type: 'number', label: 'Minimum Amount', required: false, default: 0 },
  },
  [CRITERIA_TYPES.PROTOCOL_USAGE]: {
    protocolKey: { type: 'select', label: 'Protocol', required: true, options: [] },
  },
  [CRITERIA_TYPES.PROTOCOL_COUNT]: {
    minProtocols: { type: 'number', label: 'Minimum DeFi Protocols / dApps', required: true, default: 5, min: 1 },
  },
  [CRITERIA_TYPES.PROTOCOL_LEND_AMOUNT]: {
    protocolKey: { type: 'select', label: 'Lending Protocol', required: true, options: [] },
    minAmount: { type: 'number', label: 'Minimum Lent Amount', required: true, default: 1, min: 0 },
    decimals: { type: 'number', label: 'Amount Decimals (optional)', required: false, default: 8, min: 0, max: 18 },
  },
  [CRITERIA_TYPES.DEX_TX_COUNT]: {
    protocolKey: { type: 'select', label: 'DEX Protocol', required: true, options: [] },
    minTxCount: { type: 'number', label: 'Minimum DEX Transactions', required: true, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.DEX_VOLUME]: {
    protocolKey: { type: 'select', label: 'DEX Protocol', required: true, options: [] },
    minVolume: { type: 'number', label: 'Minimum DEX Volume', required: true, default: 1, min: 0 },
    decimals: { type: 'number', label: 'Volume Decimals (optional)', required: false, default: 8, min: 0, max: 18 },
  },
  [CRITERIA_TYPES.NFT_HOLDER]: {
    collectionName: { type: 'text', label: 'Collection Name (optional)', required: false, placeholder: 'Any NFT if empty' },
    minCount: { type: 'number', label: 'Minimum NFTs', required: false, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.ALLOWLIST]: {
    addresses: { type: 'textarea', label: 'Allowed Addresses (one per line)', required: true, placeholder: '0x...\n0x...' },
  },
  [CRITERIA_TYPES.DEFI_TVL]: {
    minUsd: { type: 'number', label: 'Minimum TVL (USD)', required: true, default: 100, min: 0 },
  },
};

// ─── Badge Categories ────────────────────────────────────────────────
export const BADGE_CATEGORIES = {
  ACTIVITY: { id: 'activity', name: 'Activity', icon: '⚡', description: 'Transaction and activity milestones' },
  DEFI: { id: 'defi', name: 'DeFi', icon: '🏦', description: 'DeFi protocol participation' },
  COMMUNITY: { id: 'community', name: 'Community', icon: '🤝', description: 'Community involvement and social' },
  SPECIAL: { id: 'special', name: 'Special', icon: '✨', description: 'Limited edition and event badges' },
  LONGEVITY: { id: 'longevity', name: 'Longevity', icon: '🕐', description: 'Time-based achievements' },
};

// ─── Rarity System ───────────────────────────────────────────────────
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

// ─── On-chain Rule Types (legacy compat) ─────────────────────────────
export const BADGE_RULES = {
  ALLOWLIST: 1,
  MIN_BALANCE: 2,
  OFFCHAIN_ALLOWLIST: 3,
  TRANSACTION_COUNT: 4,
  DAYS_ONCHAIN: 5,
};

// ─── XP & Level System ───────────────────────────────────────────────
const XP_PER_LEVEL = 100;

export const getRarityInfo = (rarity) => BADGE_RARITY[rarity] || BADGE_RARITY.COMMON;

export const calculateTotalXP = (badges) => {
  return badges.reduce((total, badge) => {
    const rarity = getRarityInfo(badge.rarity || 'COMMON');
    const xpValue = badge.xp || (rarity.level * 10);
    return total + xpValue;
  }, 0);
};

export const getLevelFromXP = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;
export const getXPForLevel = (level) => (level - 1) * XP_PER_LEVEL;
export const getNextLevelXP = (xp) => getXPForLevel(getLevelFromXP(xp) + 1);

export const getLevelProgress = (xp) => {
  const currentLevel = getLevelFromXP(xp);
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLvlXP = getXPForLevel(currentLevel + 1);
  const progressXP = xp - currentLevelXP;
  const requiredXP = nextLvlXP - currentLevelXP;
  return {
    level: currentLevel,
    currentXP: xp,
    progressXP,
    requiredXP,
    percentage: requiredXP > 0 ? Math.min(100, (progressXP / requiredXP) * 100) : 100,
  };
};

// ─── Predefined Badge Templates ──────────────────────────────────────
export const ACTIVITY_BADGE_TIERS = [
  { count: 1, name: 'First Step', emoji: '👣', description: 'Made first transaction', rarity: 'COMMON', xp: 10, percentileThreshold: 95 },
  { count: 10, name: 'Active Trader', emoji: '📈', description: '10+ transactions', rarity: 'UNCOMMON', xp: 25, percentileThreshold: 70 },
  { count: 25, name: 'Committed User', emoji: '💪', description: '25+ transactions', rarity: 'RARE', xp: 40, percentileThreshold: 40 },
  { count: 50, name: 'Power User', emoji: '⚡', description: '50+ transactions', rarity: 'EPIC', xp: 60, percentileThreshold: 15 },
  { count: 100, name: 'Trade Master', emoji: '🎯', description: '100+ transactions', rarity: 'EPIC', xp: 75, percentileThreshold: 5 },
  { count: 250, name: 'Legendary Trader', emoji: '👑', description: '250+ transactions', rarity: 'LEGENDARY', xp: 100, percentileThreshold: 1 },
];

export const LONGEVITY_BADGE_TIERS = [
  { days: 7, name: '7-Day Pioneer', emoji: '🌟', description: '7 days on-chain', rarity: 'COMMON', xp: 10, percentileThreshold: 90 },
  { days: 30, name: 'Monthly Member', emoji: '📅', description: '30 days on-chain', rarity: 'UNCOMMON', xp: 25, percentileThreshold: 60 },
  { days: 100, name: 'Century Veteran', emoji: '💯', description: '100 days on-chain', rarity: 'RARE', xp: 50, percentileThreshold: 30 },
  { days: 200, name: '200-Day Champion', emoji: '🏆', description: '200 days on-chain', rarity: 'EPIC', xp: 70, percentileThreshold: 10 },
  { days: 365, name: 'Annual Legend', emoji: '🎖️', description: '365 days on-chain', rarity: 'EPIC', xp: 85, percentileThreshold: 3 },
  { days: 730, name: 'Two-Year Titan', emoji: '🚀', description: '730 days on-chain', rarity: 'LEGENDARY', xp: 120, percentileThreshold: 0.5 },
];

// ─── Badge Definition Factory ────────────────────────────────────────
export const createBadgeDefinition = ({
  name,
  description = '',
  imageUrl = '',
  category = 'activity',
  rarity = 'COMMON',
  xp = 10,
  criteria = [],
  metadata = {},
  enabled = true,
  onChainBadgeId = null,
}) => {
  const now = Date.now();
  return {
    id: `badge_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    imageUrl,
    category,
    rarity,
    xp: Number(xp) || 10,
    criteria: Array.isArray(criteria) ? criteria : [],
    metadata: {
      externalUrl: metadata.externalUrl || '',
      attributes: Array.isArray(metadata.attributes) ? metadata.attributes : [],
    },
    enabled,
    onChainBadgeId,
    createdAt: now,
    updatedAt: now,
  };
};

// ─── Validation ──────────────────────────────────────────────────────
export const validateBadgeDefinition = (badge) => {
  const errors = [];

  if (!badge.name || typeof badge.name !== 'string' || badge.name.trim().length < 2) {
    errors.push('Badge name is required (min 2 chars)');
  }
  if (badge.name && badge.name.length > 100) {
    errors.push('Badge name must be under 100 characters');
  }
  if (!badge.imageUrl || typeof badge.imageUrl !== 'string') {
    errors.push('Badge image URL is required');
  }
  if (badge.imageUrl && !badge.imageUrl.startsWith('http') && !badge.imageUrl.startsWith('data:')) {
    errors.push('Badge image URL must be a valid URL or data URI');
  }
  if (!BADGE_RARITY[badge.rarity]) {
    errors.push(`Invalid rarity: ${badge.rarity}`);
  }
  if (!Object.values(BADGE_CATEGORIES).find(c => c.id === badge.category)) {
    errors.push(`Invalid category: ${badge.category}`);
  }
  if (!Array.isArray(badge.criteria) || badge.criteria.length === 0) {
    errors.push('At least one eligibility criterion is required');
  }
  if (Array.isArray(badge.criteria)) {
    badge.criteria.forEach((c, i) => {
      if (!c.type || !Object.values(CRITERIA_TYPES).includes(c.type)) {
        errors.push(`Criterion ${i + 1}: invalid type "${c.type}"`);
      }
      if (!c.params || typeof c.params !== 'object') {
        errors.push(`Criterion ${i + 1}: params must be an object`);
      }
    });
  }
  if (typeof badge.xp !== 'number' || badge.xp < 0) {
    errors.push('XP must be a non-negative number');
  }

  return { valid: errors.length === 0, errors };
};

// ─── Utility ─────────────────────────────────────────────────────────
export const getRuleLabel = (ruleType) => {
  const rules = {
    [BADGE_RULES.ALLOWLIST]: 'Allowlist',
    [BADGE_RULES.MIN_BALANCE]: 'Minimum Balance',
    [BADGE_RULES.OFFCHAIN_ALLOWLIST]: 'Off-chain Allowlist',
    [BADGE_RULES.TRANSACTION_COUNT]: 'Transaction Count',
    [BADGE_RULES.DAYS_ONCHAIN]: 'Days On-chain',
  };
  return rules[ruleType] || 'Unknown';
};

export const POLLING_INTERVALS = {
  ELIGIBILITY_CHECK: 60_000,
  BADGE_REFRESH: 60_000,
  PROGRESS_UPDATE: 15_000,
};
