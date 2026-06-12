// Admin Service: Manages token and badge data persistence
// Uses localStorage for persistence (can be replaced with backend later)

import {
  DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS,
  normalizeLiquiditySourceIds,
} from "../config/liquiditySources";

import { getSystemConfig } from "./api";

const ADMIN_STORAGE_KEY = 'movement_admin_data';
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;

// Global cache for sync settings
let memoizedData: any = null;

export interface SwapSettings {
  feeInBps: number;
  feeReceiver: string;
  chargeFeeBy: 'token_in' | 'token_out';
  isFeeIn: boolean;
  defaultSlippagePercent: number;
  routingMode: string;
  enabledLiquiditySources: string[];
  protocolFeeBps?: number;
  referrer?: string;
  updatedAt?: string;
  mosaicApiKey?: string;
  paused?: boolean;
  enableMosaicToggle?: boolean;
  defaultProvider?: 'yuzu' | 'mosaic';
}

const DEFAULT_SWAP_SETTINGS: SwapSettings = {
  feeInBps: 0,
  feeReceiver: '',
  chargeFeeBy: 'token_in',
  isFeeIn: true,
  defaultSlippagePercent: 0.5,
  routingMode: 'mosaic',
  enabledLiquiditySources: [...DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS],
  protocolFeeBps: 0,
  referrer: '',
  mosaicApiKey: '',
  paused: false,
  enableMosaicToggle: true,
  defaultProvider: 'yuzu',
};

/**
 * Hydrate local settings from backend.
 * Called on app startup or admin login.
 */
export const syncSettingsFromBackend = async () => {
  try {
    const config = await getSystemConfig();
    if (Object.keys(config).length === 0) return;

    const data = loadAdminData();
    data.swapSettings = {
      ...data.swapSettings,
      ...config
    };
    saveAdminData(data);
    memoizedData = data;
    console.log('[AdminService] Settings synced from backend');
  } catch (err) {
    console.warn('[AdminService] Backend sync failed, using local:', err);
  }
};

const normalizeSwapSettings = (settings: Partial<SwapSettings> = {}): SwapSettings => {
  const feeInBpsValue = settings.feeInBps ?? settings.protocolFeeBps ?? 0;
  const feeInBps = Math.max(0, Math.min(500, Math.round(Number(feeInBpsValue) || 0)));
  const feeReceiver = String(settings.feeReceiver ?? settings.referrer ?? '').trim();
  const rawChargeFeeBy = String(settings.chargeFeeBy || '').trim().toLowerCase();
  
  const chargeFeeBy: 'token_in' | 'token_out' = rawChargeFeeBy === 'token_out'
    ? 'token_out'
    : 'token_in';

  const slippageRaw = Number(settings.defaultSlippagePercent);
  const defaultSlippagePercent = Number.isFinite(slippageRaw)
    ? Math.max(0.01, Math.min(50, slippageRaw))
    : DEFAULT_SWAP_SETTINGS.defaultSlippagePercent;

  const normalized = {
    ...DEFAULT_SWAP_SETTINGS,
    ...settings,
    feeInBps,
    feeReceiver,
    chargeFeeBy,
    isFeeIn: chargeFeeBy === 'token_in',
    defaultSlippagePercent,

    routingMode: ['mosaic'].includes(String(settings.routingMode || '').toLowerCase())
      ? String(settings.routingMode || '').toLowerCase()
      : DEFAULT_SWAP_SETTINGS.routingMode,
    enabledLiquiditySources: normalizeLiquiditySourceIds(
      settings.enabledLiquiditySources ?? DEFAULT_SWAP_SETTINGS.enabledLiquiditySources
    ),
    enableMosaicToggle: settings.enableMosaicToggle ?? DEFAULT_SWAP_SETTINGS.enableMosaicToggle,
    defaultProvider: ['yuzu', 'mosaic'].includes(String(settings.defaultProvider || '').toLowerCase())
      ? (String(settings.defaultProvider || '').toLowerCase() as 'yuzu' | 'mosaic')
      : DEFAULT_SWAP_SETTINGS.defaultProvider,
  };

  normalized.protocolFeeBps = feeInBps;
  normalized.referrer = feeReceiver;

  return normalized;
};

const toPersistedAdminData = (data) => {
  return {
    ...data,
    swapSettings: { ...(data.swapSettings || {}) },
  };
};

// Load admin data from localStorage
export const loadAdminData = () => {
  if (memoizedData) return memoizedData;

  try {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!stored) {
      memoizedData = {
        badges: [],
        swapSettings: { ...DEFAULT_SWAP_SETTINGS },
      };
      return memoizedData;
    }
    const parsed = JSON.parse(stored);
    memoizedData = {
      badges: parsed.badges || [],
      swapSettings: normalizeSwapSettings(parsed.swapSettings || {}),
    };
    return memoizedData;
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
    memoizedData = data;
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(toPersistedAdminData(data)));
    return true;
  } catch (error) {
    console.error('Failed to save admin data:', error);
    return false;
  }
};

// ... (other functions remain the same)

// Swap settings
export const getSwapSettings = () => {
  const data = loadAdminData();
  return normalizeSwapSettings(data.swapSettings || {});
};

export const updateSwapSettings = (updates) => {
  const data = loadAdminData();



  const receiver = String(updates?.feeReceiver ?? '').trim();
  if (receiver && !ADDRESS_PATTERN.test(receiver)) {
    throw new Error('Fee receiver must be a valid 0x address');
  }

  const current = normalizeSwapSettings(data.swapSettings || {});
  const next = normalizeSwapSettings({
    ...current,
    ...updates,

    updatedAt: new Date().toISOString(),
  });
  const nextData = {
    ...data,
    swapSettings: next,
  };
  saveAdminData(nextData);
  return next;
};


