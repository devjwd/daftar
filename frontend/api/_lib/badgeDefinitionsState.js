import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadState, saveState } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const normalizeBadgeDefinitions = (value) => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    if (!id || !name) continue;

    deduped.set(id, {
      ...entry,
      id,
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      imageUrl: typeof entry.imageUrl === 'string' ? entry.imageUrl : '',
      category: typeof entry.category === 'string' ? entry.category : 'activity',
      rarity: typeof entry.rarity === 'string' ? entry.rarity : 'COMMON',
      xp: Number(entry.xp) || 0,
      mintFee: Number(entry.mintFee) || 0,
      criteria: Array.isArray(entry.criteria) ? entry.criteria : [],
      metadata:
        entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
          ? entry.metadata
          : {},
      enabled: entry.enabled !== false,
      onChainBadgeId:
        entry?.onChainBadgeId == null || entry?.onChainBadgeId === ''
          ? null
          : Number(entry.onChainBadgeId),
      createdAt: entry.createdAt || null,
      updatedAt: entry.updatedAt || null,
    });
  }

  return Array.from(deduped.values());
};

export const loadStaticBadgeDefinitions = () => {
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, './badgeDefinitions.json'), 'utf8'));
    return normalizeBadgeDefinitions(raw);
  } catch {
    return [];
  }
};

export const loadResolvedBadgeDefinitions = async () => {
  const state = await loadState();
  const fromState = normalizeBadgeDefinitions(state.badgeDefinitions);
  if (fromState.length > 0) {
    return { badges: fromState, source: 'state' };
  }

  const fromStatic = loadStaticBadgeDefinitions();
  return { badges: fromStatic, source: 'static' };
};

export const saveBadgeDefinitions = async (badgeDefinitions) => {
  const normalized = normalizeBadgeDefinitions(badgeDefinitions);
  const { userAwards, trackedAddresses, badgeConfigs } = await loadState();
  await saveState(userAwards, trackedAddresses, badgeConfigs, normalized);
  return normalized;
};

export const validateBadgeDefinitionsPayload = (value) => {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'badges must be an array' };
  }

  if (value.length > 1000) {
    return { ok: false, error: 'badges exceeds maximum size (1000)' };
  }

  const normalized = normalizeBadgeDefinitions(value);
  if (normalized.length === 0 && value.length > 0) {
    return { ok: false, error: 'badges has no valid entries' };
  }

  return { ok: true, normalized };
};
