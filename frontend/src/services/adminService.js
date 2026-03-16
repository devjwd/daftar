// Admin Service: Manages token and badge data persistence
// Uses localStorage for persistence (can be replaced with backend later)

import {
  DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS,
  normalizeLiquiditySourceIds,
} from "../config/liquiditySources";

const ADMIN_STORAGE_KEY = 'movement_admin_data';
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;

let runtimeMosaicApiKey = '';

const DEFAULT_SWAP_SETTINGS = {
  feeInBps: 0,
  feeReceiver: '',
  isFeeIn: true,
  defaultSlippagePercent: 0.5,
  mosaicApiKey: '',
  routingMode: 'mosaic',
  enabledLiquiditySources: [...DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS],
  // Legacy compatibility fields
  protocolFeeBps: 0,
  referrer: '',
};

const normalizeSwapSettings = (settings = {}) => {
  const feeInBpsValue = settings.feeInBps ?? settings.protocolFeeBps ?? 0;
  const feeInBps = Math.max(0, Math.min(500, Math.round(Number(feeInBpsValue) || 0)));
  const feeReceiver = String(settings.feeReceiver ?? settings.referrer ?? '').trim();

  const slippageRaw = Number(settings.defaultSlippagePercent);
  const defaultSlippagePercent = Number.isFinite(slippageRaw)
    ? Math.max(0.01, Math.min(50, slippageRaw))
    : DEFAULT_SWAP_SETTINGS.defaultSlippagePercent;

  const normalized = {
    ...DEFAULT_SWAP_SETTINGS,
    ...settings,
    feeInBps,
    feeReceiver,
    isFeeIn: Boolean(settings.isFeeIn ?? DEFAULT_SWAP_SETTINGS.isFeeIn),
    defaultSlippagePercent,
    mosaicApiKey: String(settings.mosaicApiKey ?? runtimeMosaicApiKey ?? '').trim(),
    routingMode: ['mosaic'].includes(String(settings.routingMode || '').toLowerCase())
      ? String(settings.routingMode || '').toLowerCase()
      : DEFAULT_SWAP_SETTINGS.routingMode,
    enabledLiquiditySources: normalizeLiquiditySourceIds(
      settings.enabledLiquiditySources ?? DEFAULT_SWAP_SETTINGS.enabledLiquiditySources
    ),
  };

  normalized.protocolFeeBps = feeInBps;
  normalized.referrer = feeReceiver;

  return normalized;
};

const toPersistedAdminData = (data) => {
  const nextSwap = {
    ...(data.swapSettings || {}),
    mosaicApiKey: '',
  };

  return {
    ...data,
    swapSettings: nextSwap,
  };
};

// Load admin data from localStorage
export const loadAdminData = () => {
  try {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!stored) {
      return {
        badges: [],
        swapSettings: { ...DEFAULT_SWAP_SETTINGS },
      };
    }
    const parsed = JSON.parse(stored);
    return {
      badges: parsed.badges || [],
      swapSettings: normalizeSwapSettings(parsed.swapSettings || {}),
    };
  } catch (error) {
    console.error('Failed to load admin data:', error);
    return {
      badges: [],
      swapSettings: { ...DEFAULT_SWAP_SETTINGS },
    };
  }
};

// Save admin data to localStorage
export const saveAdminData = (data) => {
  try {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(toPersistedAdminData(data)));
    return true;
  } catch (error) {
    console.error('Failed to save admin data:', error);
    return false;
  }
};

// Add a new badge
export const addBadge = (badge) => {
  const data = loadAdminData();
  
  // Validate required fields
  if (!badge.name || !badge.description || !badge.icon) {
    throw new Error('Missing required fields: name, description, icon');
  }
  
  // Check for duplicates
  if (data.badges.some(b => b.name.toLowerCase() === badge.name.toLowerCase())) {
    throw new Error('Badge with this name already exists');
  }
  
  // Generate next ID
  const maxId = data.badges.length > 0 ? Math.max(...data.badges.map(b => b.id)) : 0;
  
  const newBadge = {
    ...badge,
    id: maxId + 1,
    createdAt: new Date().toISOString(),
    earned: badge.earned || false,
  };
  
  data.badges.push(newBadge);
  saveAdminData(data);
  
  return newBadge;
};

// Update badge
export const updateBadge = (badgeId, updates) => {
  const data = loadAdminData();
  const index = data.badges.findIndex(b => b.id === badgeId);
  
  if (index === -1) {
    throw new Error('Badge not found');
  }
  
  data.badges[index] = {
    ...data.badges[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  saveAdminData(data);
  return data.badges[index];
};

// Delete badge
export const deleteBadge = (badgeId) => {
  const data = loadAdminData();
  data.badges = data.badges.filter(b => b.id !== badgeId);
  saveAdminData(data);
};

// Get all custom badges
export const getCustomBadges = () => {
  const data = loadAdminData();
  return data.badges;
};

// Swap settings (Mosaic integrator fees, referrer, etc.)
export const getSwapSettings = () => {
  const data = loadAdminData();
  return normalizeSwapSettings({
    ...(data.swapSettings || {}),
    mosaicApiKey: runtimeMosaicApiKey,
  });
};

export const updateSwapSettings = (updates) => {
  const data = loadAdminData();

  if (Object.prototype.hasOwnProperty.call(updates || {}, 'mosaicApiKey')) {
    runtimeMosaicApiKey = String(updates.mosaicApiKey || '').trim();
  }

  const receiver = String(updates?.feeReceiver ?? '').trim();
  if (receiver && !ADDRESS_PATTERN.test(receiver)) {
    throw new Error('Fee receiver must be a valid 0x address');
  }

  const current = normalizeSwapSettings(data.swapSettings || {});
  const next = normalizeSwapSettings({
    ...current,
    ...updates,
    mosaicApiKey: runtimeMosaicApiKey,
    updatedAt: new Date().toISOString(),
  });
  const nextData = {
    ...data,
    swapSettings: next,
  };
  saveAdminData(nextData);
  return next;
};

// Export admin data (for backup)
export const exportAdminData = () => {
  const data = loadAdminData();
  return JSON.stringify(toPersistedAdminData(data), null, 2);
};

// Import admin data (for restore)
export const importAdminData = (jsonData) => {
  try {
    const data = JSON.parse(jsonData);

    const normalized = {
      badges: Array.isArray(data.badges) ? data.badges : [],
      swapSettings: normalizeSwapSettings(data.swapSettings || {}),
    };

    runtimeMosaicApiKey = String(normalized.swapSettings.mosaicApiKey || runtimeMosaicApiKey || '').trim();
    normalized.swapSettings.mosaicApiKey = '';

    saveAdminData(normalized);
    return true;
  } catch (error) {
    console.error('Failed to import admin data:', error);
    throw error;
  }
};

// Clear all custom data
export const clearAllAdminData = () => {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
};
