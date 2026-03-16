import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadState, saveState } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const normalizeConfigs = (value) => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map();
  for (const entry of value) {
    const badgeId = String(entry?.badgeId || '').trim();
    const rule = Number(entry?.rule);
    if (!badgeId || !Number.isFinite(rule) || rule <= 0) continue;

    deduped.set(badgeId, {
      badgeId,
      rule,
      params: entry?.params && typeof entry.params === 'object' && !Array.isArray(entry.params) ? entry.params : {},
      onChainBadgeId:
        entry?.onChainBadgeId == null || entry?.onChainBadgeId === ''
          ? null
          : Number(entry.onChainBadgeId),
    });
  }

  return Array.from(deduped.values());
};

export const loadStaticBadgeConfigs = () => {
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, './badgeConfigs.json'), 'utf8'));
    return normalizeConfigs(raw);
  } catch {
    return [];
  }
};

export const loadResolvedBadgeConfigs = async () => {
  const state = await loadState();
  const fromState = normalizeConfigs(state.badgeConfigs);
  if (fromState.length > 0) {
    return { configs: fromState, source: 'state' };
  }

  const fromStatic = loadStaticBadgeConfigs();
  return { configs: fromStatic, source: 'static' };
};

export const saveBadgeConfigs = async (badgeConfigs) => {
  const normalized = normalizeConfigs(badgeConfigs);
  const { userAwards, trackedAddresses } = await loadState();
  await saveState(userAwards, trackedAddresses, normalized);
  return normalized;
};

export const validateBadgeConfigsPayload = (value) => {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'badgeConfigs must be an array' };
  }

  if (value.length > 1000) {
    return { ok: false, error: 'badgeConfigs exceeds maximum size (1000)' };
  }

  const normalized = normalizeConfigs(value);
  if (normalized.length === 0 && value.length > 0) {
    return { ok: false, error: 'badgeConfigs has no valid entries' };
  }

  return { ok: true, normalized };
};
