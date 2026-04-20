export const GLOBAL_SETTINGS_KEY = 'settings_global';
export const DEFAULT_HIDE_POSITION_THRESHOLD = 0;
export const HIDE_POSITION_THRESHOLD_OPTIONS = [0, 0.01, 0.1, 1, 10];

export const getSettingsStorageKey = (accountAddress) => {
  if (!accountAddress) return GLOBAL_SETTINGS_KEY;

  return `settings_${typeof accountAddress === 'string' ? accountAddress : accountAddress.toString()}`;
};

const normalizeHidePositionThreshold = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_HIDE_POSITION_THRESHOLD;
  }

  const matchedOption = HIDE_POSITION_THRESHOLD_OPTIONS.find((option) => option === numericValue);
  return matchedOption ?? DEFAULT_HIDE_POSITION_THRESHOLD;
};

export const readStoredSettings = (settingsKey = GLOBAL_SETTINGS_KEY) => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(settingsKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const writeStoredSettings = (settingsKey = GLOBAL_SETTINGS_KEY, updates = {}, mirrorToGlobal = false) => {
  if (typeof window === 'undefined') return {};

  const nextScopedSettings = {
    ...readStoredSettings(settingsKey),
    ...updates,
  };

  window.localStorage.setItem(settingsKey, JSON.stringify(nextScopedSettings));

  if (mirrorToGlobal && settingsKey !== GLOBAL_SETTINGS_KEY) {
    const nextGlobalSettings = {
      ...readStoredSettings(GLOBAL_SETTINGS_KEY),
      ...updates,
    };

    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(nextGlobalSettings));
  }

  return nextScopedSettings;
};

export const getStoredHidePositionThreshold = (settingsKey = null) => {
  if (typeof window === 'undefined') return DEFAULT_HIDE_POSITION_THRESHOLD;

  if (settingsKey) {
    const scopedSettings = readStoredSettings(settingsKey);
    if (Object.prototype.hasOwnProperty.call(scopedSettings, 'hidePositionThreshold')) {
      return normalizeHidePositionThreshold(scopedSettings.hidePositionThreshold);
    }
  }

  const globalSettings = readStoredSettings(GLOBAL_SETTINGS_KEY);
  return normalizeHidePositionThreshold(globalSettings.hidePositionThreshold);
};

export const formatHidePositionThresholdLabel = (threshold) => {
  if (threshold === 0) return 'Show All';
  if (threshold < 1) return `Under $${threshold.toFixed(2)}`;
  return `Under $${threshold.toFixed(0)}`;
};