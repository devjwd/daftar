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
  // New criteria types for v2
  DAPP_USAGE: 'dapp_usage',
  HOLDING_PERIOD: 'holding_period',
  COMPOSITE: 'composite',
  // Daftar Specific
  DAFTAR_PROFILE_COMPLETE: 'daftar_profile_complete',
  DAFTAR_SWAP_COUNT: 'daftar_swap_count',
  DAFTAR_VOLUME_USD: 'daftar_volume_usd',
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
  [CRITERIA_TYPES.DAPP_USAGE]: 'dApp Usage',
  [CRITERIA_TYPES.HOLDING_PERIOD]: 'Holding Period',
  [CRITERIA_TYPES.COMPOSITE]: 'Multiple Rules',
  [CRITERIA_TYPES.DAFTAR_PROFILE_COMPLETE]: 'Daftar Profile Complete',
  [CRITERIA_TYPES.DAFTAR_SWAP_COUNT]: 'Daftar Swap Count',
  [CRITERIA_TYPES.DAFTAR_VOLUME_USD]: 'Daftar Trade Volume (USD)',
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
    collectionAddress: { type: 'text', label: 'Collection Address', required: false, placeholder: '0x...' },
    minCount: { type: 'number', label: 'Minimum NFTs', required: false, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.ALLOWLIST]: {
    addresses: { type: 'textarea', label: 'Allowed Addresses (one per line)', required: true, placeholder: '0x...\n0x...' },
  },
  [CRITERIA_TYPES.DEFI_TVL]: {
    minUsd: { type: 'number', label: 'Minimum TVL (USD)', required: true, default: 100, min: 0 },
  },
  [CRITERIA_TYPES.DAPP_USAGE]: {
    dappAddress: { type: 'text', label: 'dApp Contract Address', required: true, placeholder: '0x...' },
    dappName: { type: 'text', label: 'dApp Name (for display)', required: false, placeholder: 'My dApp' },
    minInteractions: { type: 'number', label: 'Minimum Interactions', required: true, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.HOLDING_PERIOD]: {
    coinType: { type: 'text', label: 'Coin Type (full path)', required: true, placeholder: '0x1::aptos_coin::AptosCoin' },
    minAmount: { type: 'number', label: 'Minimum Amount', required: true, default: 1, min: 0 },
    minDays: { type: 'number', label: 'Minimum Days Held', required: true, default: 30, min: 1 },
  },
  [CRITERIA_TYPES.COMPOSITE]: {
    operator: { type: 'select', label: 'Logic Operator', required: true, options: [
      { value: 'AND', label: 'All rules must pass (AND)' },
      { value: 'OR', label: 'Any rule can pass (OR)' },
    ]},
    // Sub-rules are added dynamically in the admin UI
  },
  [CRITERIA_TYPES.DAFTAR_PROFILE_COMPLETE]: {
    requirePfp: { type: 'boolean', label: 'Require Profile Picture', default: true },
    requireBio: { type: 'boolean', label: 'Require Bio', default: true },
  },
  [CRITERIA_TYPES.DAFTAR_SWAP_COUNT]: {
    min: { type: 'number', label: 'Minimum Swaps', required: true, default: 1, min: 1 },
  },
  [CRITERIA_TYPES.DAFTAR_VOLUME_USD]: {
    min: { type: 'number', label: 'Minimum Volume (USD)', required: true, default: 10, min: 1 },
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
    color: '#5c8ead',
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
    color: '#e57c23',
    borderColor: '#d97706',
    bgGradient: 'linear-gradient(135deg, rgba(229, 124, 35, 0.1) 0%, rgba(229, 124, 35, 0.05) 100%)',
    glowColor: 'rgba(229, 124, 35, 0.3)',
  },
  LEGENDARY: {
    level: 5,
    name: 'Legendary',
    color: '#ee8f3a',
    borderColor: '#b45309',
    bgGradient: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.08) 100%)',
    glowColor: 'rgba(251, 191, 36, 0.5)',
  },
};

// ─── On-chain Rule Types (matches smart contract) ────────────────────
export const BADGE_RULES = {
  ALLOWLIST: 1,         // Admin-managed whitelist
  MIN_BALANCE: 2,       // Minimum token balance (on-chain verified)
  ATTESTATION: 3,       // Off-chain verified, admin attests
  TX_COUNT: 4,          // Minimum transaction count
  ACTIVE_DAYS: 5,       // Minimum days with activity
  PROTOCOL_COUNT: 6,    // Minimum DeFi protocols used
  DAPP_USAGE: 7,        // Specific dApp interaction
  HOLDING_PERIOD: 8,    // Hold tokens for duration
  NFT_HOLDER: 9,        // Must hold specific NFT
  COMPOSITE: 10,        // Multiple rules (AND logic)
  // Legacy aliases
  OFFCHAIN_ALLOWLIST: 3,
  TRANSACTION_COUNT: 4,
  DAYS_ONCHAIN: 5,
};

// ─── Badge Status (matches smart contract) ───────────────────────────
export const BADGE_STATUS = {
  ACTIVE: 1,            // Badge is active and mintable
  PAUSED: 2,            // Badge is temporarily paused
  DISCONTINUED: 3,      // Badge is permanently discontinued
};

export const BADGE_STATUS_LABELS = {
  [BADGE_STATUS.ACTIVE]: 'Active',
  [BADGE_STATUS.PAUSED]: 'Paused',
  [BADGE_STATUS.DISCONTINUED]: 'Discontinued',
};

export const BADGE_STATUS_COLORS = {
  [BADGE_STATUS.ACTIVE]: '#10b981',     // Green
  [BADGE_STATUS.PAUSED]: '#f59e0b',     // Amber
  [BADGE_STATUS.DISCONTINUED]: '#ef4444', // Red
};

// ─── XP & Level System ───────────────────────────────────────────────
const LEVEL_XP_REQUIREMENTS = [
  0,      // Level 1
  100,    // Level 2
  200,    // Level 3
  400,    // Level 4
  600,    // Level 5
  900,    // Level 6
  1200,   // Level 7
  1600,   // Level 8
  2000,   // Level 9
  2500,   // Level 10
  3200,   // Level 11
  4000,   // Level 12
  5000,   // Level 13
  6200,   // Level 14
  7500,   // Level 15
  9000,   // Level 16
  11000,  // Level 17
  13500,  // Level 18
  16500,  // Level 19
  20000,  // Level 20
];

export const getRarityInfo = (rarity) => BADGE_RARITY[rarity] || BADGE_RARITY.COMMON;

export const calculateTotalXP = (badges) => {
  return badges.reduce((total, badge) => {
    const rarity = getRarityInfo(badge.rarity || 'COMMON');
    const xpValue = badge.xp || (rarity.level * 10);
    return total + xpValue;
  }, 0);
};

export const getLevelFromXP = (xp) => {
  const numericXP = Number(xp) || 0;
  for (let i = LEVEL_XP_REQUIREMENTS.length - 1; i >= 0; i--) {
    if (numericXP >= LEVEL_XP_REQUIREMENTS[i]) {
      return i + 1;
    }
  }
  return 1;
};

export const getXPForLevel = (level) => {
  const lvl = Math.max(1, Math.min(level, LEVEL_XP_REQUIREMENTS.length));
  return LEVEL_XP_REQUIREMENTS[lvl - 1];
};

export const getNextLevelXP = (xp) => {
  const currentLvl = getLevelFromXP(xp);
  if (currentLvl >= LEVEL_XP_REQUIREMENTS.length) {
    // If max level reached, we could return a theoretical next level with +5000 XP increments
    return LEVEL_XP_REQUIREMENTS[LEVEL_XP_REQUIREMENTS.length - 1] + 5000;
  }
  return LEVEL_XP_REQUIREMENTS[currentLvl];
};

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

// ─── Badge Definition Factory ────────────────────────────────────────
export const createBadgeDefinition = ({
  id,
  name,
  description = '',
  imageUrl = '',
  category = 'activity',
  rarity = 'COMMON',
  xp = 10,
  mintFee = 0,
  criteria = [],
  metadata = {},
  isPublic = true,
  enabled = true,
  onChainBadgeId = null,
}) => {
  const now = Date.now();
  const specialMeta = metadata.special && typeof metadata.special === 'object'
    ? metadata.special
    : {};

  return {
    id: id || `badge_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    imageUrl,
    category,
    rarity,
    xp: Number(xp) || 10,
    mintFee: Number(mintFee) || 0,
    criteria: Array.isArray(criteria) ? criteria : [],
    metadata: {
      externalUrl: metadata.externalUrl || '',
      attributes: Array.isArray(metadata.attributes) ? metadata.attributes : [],
      special: {
        isSpecial: Boolean(specialMeta.isSpecial),
        timeLimited: {
          enabled: Boolean(specialMeta.timeLimited?.enabled),
          startsAt: specialMeta.timeLimited?.startsAt || '',
          endsAt: specialMeta.timeLimited?.endsAt || '',
          note: specialMeta.timeLimited?.note || '',
        },
        reward: {
          enabled: Boolean(specialMeta.reward?.enabled),
          winnerLimit: Number(specialMeta.reward?.winnerLimit) || 100,
          rewardTitle: specialMeta.reward?.rewardTitle || '',
          rewardDetails: specialMeta.reward?.rewardDetails || '',
          rewardType: specialMeta.reward?.rewardType || '',
          rewardValue: specialMeta.reward?.rewardValue || '',
          distributionDate: specialMeta.reward?.distributionDate || '',
        },
      },
    },
    isPublic: isPublic !== false,
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
  if (Number(badge.mintFee) < 0) {
    errors.push('Mint fee must be zero or greater');
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
    [BADGE_RULES.ATTESTATION]: 'Off-chain Attestation',
    [BADGE_RULES.TX_COUNT]: 'Transaction Count',
    [BADGE_RULES.ACTIVE_DAYS]: 'Active Days',
    [BADGE_RULES.PROTOCOL_COUNT]: 'Protocol Count',
    [BADGE_RULES.DAPP_USAGE]: 'dApp Usage',
    [BADGE_RULES.HOLDING_PERIOD]: 'Holding Period',
    [BADGE_RULES.NFT_HOLDER]: 'NFT Holder',
    [BADGE_RULES.COMPOSITE]: 'Composite Rules',
  };
  return rules[ruleType] || 'Unknown';
};

// Map criteria type to on-chain rule type
export const criteriaToRuleType = (criteriaType) => {
  const mapping = {
    [CRITERIA_TYPES.ALLOWLIST]: BADGE_RULES.ALLOWLIST,
    [CRITERIA_TYPES.MIN_BALANCE]: BADGE_RULES.MIN_BALANCE,
    [CRITERIA_TYPES.TRANSACTION_COUNT]: BADGE_RULES.TX_COUNT,
    [CRITERIA_TYPES.DAYS_ONCHAIN]: BADGE_RULES.ACTIVE_DAYS,
    [CRITERIA_TYPES.PROTOCOL_COUNT]: BADGE_RULES.PROTOCOL_COUNT,
    [CRITERIA_TYPES.PROTOCOL_USAGE]: BADGE_RULES.DAPP_USAGE,
    [CRITERIA_TYPES.DAPP_USAGE]: BADGE_RULES.DAPP_USAGE,
    [CRITERIA_TYPES.NFT_HOLDER]: BADGE_RULES.NFT_HOLDER,
    [CRITERIA_TYPES.HOLDING_PERIOD]: BADGE_RULES.HOLDING_PERIOD,
    [CRITERIA_TYPES.COMPOSITE]: BADGE_RULES.COMPOSITE,
    // Default to attestation for complex off-chain rules
    [CRITERIA_TYPES.TOKEN_HOLDER]: BADGE_RULES.ATTESTATION,
    [CRITERIA_TYPES.PROTOCOL_LEND_AMOUNT]: BADGE_RULES.ATTESTATION,
    [CRITERIA_TYPES.DEX_TX_COUNT]: BADGE_RULES.ATTESTATION,
    [CRITERIA_TYPES.DEX_VOLUME]: BADGE_RULES.ATTESTATION,
    [CRITERIA_TYPES.DEFI_TVL]: BADGE_RULES.ATTESTATION,
  };
  return mapping[criteriaType] || BADGE_RULES.ATTESTATION;
};

export const POLLING_INTERVALS = {
  ELIGIBILITY_CHECK: 60_000,
  BADGE_REFRESH: 60_000,
  PROGRESS_UPDATE: 15_000,
};
