import { supabase } from './supabase';

// Normalize to compact format: 0x00ab → 0xab (matches server/transactionService)
const normalizeEntityAddress = (address) => {
  const raw = String(address || '').trim().toLowerCase();
  if (!raw) return null;
  const stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[a-f0-9]+$/i.test(stripped)) return null;
  const compact = stripped.replace(/^0+/, '') || '0';
  return `0x${compact}`;
};

let entitiesCache = new Map();
let lastSync = 0;
const CACHE_TTL = 300000; // 5 minutes

/**
 * Fetch and cache tracked entities from Supabase
 */
export const syncEntities = async (force = false) => {
  if (!force && Date.now() - lastSync < CACHE_TTL && entitiesCache.size > 0) {
    return entitiesCache;
  }

  try {
    if (!supabase) return entitiesCache;

    const { data: entities, error } = await supabase
      .from('tracked_entities')
      .select('*')
      .eq('is_verified', true);

    if (error) {
      console.warn('Failed to sync entities:', error);
      return entitiesCache;
    }

    const newMap = new Map();
    if (Array.isArray(entities)) {
      entities.forEach(entity => {
        if (entity.address) {
          // Store with normalized compact address as key
          const normalized = normalizeEntityAddress(entity.address);
          if (normalized) {
            newMap.set(normalized, entity);
          }
        }
      });
    }

    entitiesCache = newMap;
    lastSync = Date.now();
    return entitiesCache;
  } catch (error) {
    console.warn('entityStore error:', error);
    return entitiesCache;
  }
};

/**
 * Find an entity by address (cached)
 */
export const findEntityByAddress = (address) => {
  if (!address) return null;
  const normalized = normalizeEntityAddress(address);
  return normalized ? (entitiesCache.get(normalized) || null) : null;
};

export const findEntityByName = (name) => {
  if (!name) return null;
  const searchName = name.toLowerCase().trim();
  for (const entity of entitiesCache.values()) {
    if (entity.name.toLowerCase().trim() === searchName) {
      return entity;
    }
  }
  return null;
};

/**
 * Helper to get the name and logo for an address if it's a tracked entity
 */
export const resolveEntityBranding = (address) => {
  const entity = findEntityByAddress(address);
  if (!entity) return null;

  return {
    key: `entity_${entity.id}`,
    name: entity.name,
    logo: entity.logo_url,
    website: entity.website_url,
    is_verified: entity.is_verified,
    category: entity.category
  };
};
/**
 * Search entities by name or address
 */
export const searchEntities = (query) => {
  if (!query) return [];
  const q = query.toLowerCase().trim();
  const results = [];

  for (const entity of entitiesCache.values()) {
    if (
      entity.name.toLowerCase().includes(q) ||
      entity.address.toLowerCase() === q
    ) {
      results.push(entity);
    }
  }

  return results.slice(0, 5);
};

// Initial sync on module load
syncEntities().catch(() => {});
