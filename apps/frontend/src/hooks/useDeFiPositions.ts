import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useMovementClient } from "./useMovementClient";
import { ALL_ADAPTERS } from "../config/adapters/index";
import { DEFI_PROTOCOLS as PROTOCOL_REGISTRY } from "../config/protocols";
import { devLog } from "../utils/devLogger";
import { resolveTokenPrice } from "../utils/price";
import { normalizeAddress } from "../utils/address";

/**
 * =============================================================================
 * ADAPTER-DRIVEN DEFI DISCOVERY ENGINE v3.1
 * =============================================================================
 * 
 * A robust, modular DeFi position scanner for Movement Network that:
 * 1. Uses a Registry of Protocol Adapters (no hardcoded logic here)
 * 2. Scans account resources and applies adapter-specific parsers
 * 3. Supports async discovery (on-chain views, indexer queries)
 * 4. Deduplicates positions by protocol-unique keys
 */

const DEFI_POSITION_CACHE_TTL_MS = 2 * 60 * 1000;
const RESOURCE_CACHE_TTL_MS = 45 * 1000;
const DEFI_POSITION_CACHE_PREFIX = "movement_defi_discovery_v3:";

const accountResourcesCache = new Map();
const defiPositionsCache = new Map();

const getFreshCacheEntry = (cache, key, ttlMs) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.value !== undefined && (Date.now() - entry.cachedAt) < ttlMs) {
    return entry.value;
  }
  return null;
};

const loadPersistedDeFiPositions = (address) => {
  if (!address) return null;
  const memoryEntry = getFreshCacheEntry(defiPositionsCache, address, DEFI_POSITION_CACHE_TTL_MS);
  if (memoryEntry) return memoryEntry;

  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(`${DEFI_POSITION_CACHE_PREFIX}${address}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.positions)) return null;

    if ((Date.now() - parsed.cachedAt) >= DEFI_POSITION_CACHE_TTL_MS) return null;

    defiPositionsCache.set(address, {
      value: parsed,
      cachedAt: parsed.cachedAt,
    });

    return parsed;
  } catch {
    return null;
  }
};

const persistDeFiPositions = (address, positions) => {
  if (!address || !Array.isArray(positions)) return;

  const snapshot = {
    positions,
    cachedAt: Date.now(),
  };

  defiPositionsCache.set(address, {
    value: snapshot,
    cachedAt: snapshot.cachedAt,
  });

  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(`${DEFI_POSITION_CACHE_PREFIX}${address}`, JSON.stringify(snapshot));
  } catch {
    // ignore storage failures
  }
};

export const useDeFiPositions = (searchAddress = null, priceMap = {}, balances = []) => {
  const { account, connected } = useWallet();
  const { client, loading: clientLoading, error: clientError } = useMovementClient();

  const targetAddress = useMemo(() => {
    if (searchAddress) return normalizeAddress(searchAddress);
    if (connected && account?.address) return normalizeAddress(account.address.toString());
    return null;
  }, [searchAddress, connected, account]);

  const [positions, setPositions] = useState(() => {
    const cached = loadPersistedDeFiPositions(targetAddress);
    return cached?.positions || [];
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchInProgress = useRef(false);
  const lastFetchedAddress = useRef(null);
  const fetchGeneration = useRef(0);

  const fetchPositions = useCallback(async (options: { force?: boolean } = {}) => {
    const forceRefresh = options.force === true;

    if (!targetAddress) {
      setPositions([]);
      setLoading(false);
      return;
    }

    if (!client) {
      if (clientError) setError(clientError.message || "Movement client error");
      return;
    }

    if (fetchInProgress.current) return;

    const cachedSnapshot = loadPersistedDeFiPositions(targetAddress);
    if (cachedSnapshot?.positions?.length && !forceRefresh && lastFetchedAddress.current === targetAddress) {
      setPositions(cachedSnapshot.positions);
      setLoading(false);
      return;
    }

    fetchInProgress.current = true;
    lastFetchedAddress.current = targetAddress;
    fetchGeneration.current += 1;
    const currentGeneration = fetchGeneration.current;
    
    setLoading(true);
    setError(null);

    devLog(`🔍 [DeFi Discovery] Scanning ${targetAddress}...`);

    try {
      // 1. Fetch account resources (cached)
      const resources = await (async () => {
        const cacheKey = `resources:${targetAddress}`;
        const cached = getFreshCacheEntry(accountResourcesCache, cacheKey, RESOURCE_CACHE_TTL_MS);
        if (cached) return cached;

        const fetched = await client.getAccountResources({ accountAddress: targetAddress.toString() });
        accountResourcesCache.set(cacheKey, { value: fetched, cachedAt: Date.now() });
        return fetched;
      })();

      const discoveredMap = new Map();

      // 2. Resource-Based Discovery (Sync)
      // Iterates resources and applies matching adapters
      for (const resource of resources) {
        for (const adapter of ALL_ADAPTERS as any[]) {
          if (!adapter.searchString || !adapter.parse) continue;
          
          if (resource.type.includes(adapter.searchString)) {
            if (typeof adapter.filterType === "function" && !adapter.filterType(resource.type)) continue;

            try {
              const parsed = adapter.parse(resource.data, resource.type);
              if (!parsed || parsed === "0") continue;

              const protocolKey = adapter.id.split('_')[0].toUpperCase();
              const protocol = PROTOCOL_REGISTRY[protocolKey];

              // Handle array returns for multiple positions from one resource
              const positionItems = Array.isArray(parsed) ? parsed : [parsed];

              positionItems.forEach((item, idx) => {
                const amount = typeof item === 'object' ? (item.numericValue || parseFloat(item.value)) : parseFloat(item);
                if (isNaN(amount) || amount <= 0) return;

                const symbol = typeof item === 'object' ? item.tokenSymbol : (adapter.id.includes('move') ? 'MOVE' : null);
                
                // Final fallback for USD price if the adapter didn't provide it
                const price = resolveTokenPrice(priceMap, resource.type, symbol);
                const numericValue = (typeof item === 'object' && item.usdValue) ? item.usdValue : (amount * price);

                const posId = `${adapter.id}_${resource.type.split('<')[0]}_${idx}`;
                if (!discoveredMap.has(posId)) {
                   let position: any = {
                    id: posId,
                    name: typeof item === 'object' ? (item.name || adapter.name) : adapter.name,
                    type: adapter.type,
                    value: typeof item === 'object' ? item.value : String(amount),
                    amount,
                    numericValue,
                    usdValue: numericValue,
                    tokenSymbol: symbol,
                    resourceType: resource.type,
                    source: "resource",
                    protocol: adapter.id.split('_')[0], // Default protocol ID from adapter
                    protocolName: protocol?.name || adapter.name.split(' ')[0],
                    protocolWebsite: protocol?.website,
                    ... (typeof item === 'object' ? item : {})
                  };

                  // Apply adapter-specific enrichment if available
                  if (adapter.onDiscover) {
                    position = adapter.onDiscover(position);
                  }

                  discoveredMap.set(posId, position);
                }
              });
            } catch (err) {
              devLog(`  ⚠️ Adapter ${adapter.id} parse error:`, err.message);
            }
          }
        }
      }

      // 3. Functional Discovery (Async)
      // Calls specialized discovery methods (Indexer, NFT scans, View functions)
      const discoveryResults = await Promise.all(
        (ALL_ADAPTERS as any[]).filter(a => typeof a.discover === 'function').map(async (adapter) => {
          try {
            const context = { client, targetAddress, priceMap, resources, balances };
            const found = await adapter.discover(context);
            return Array.isArray(found) ? found : [];
          } catch (err) {
            devLog(`  ⚠️ Adapter ${adapter.id} discovery error:`, err.message);
            return [];
          }
        })
      );

      // Merge functional discovery results
      discoveryResults.flat().forEach(pos => {
        if (pos && pos.id && !discoveredMap.has(pos.id)) {
          discoveredMap.set(pos.id, {
            ...pos,
            source: pos.source || "discovery"
          });
        }
      });

      const finalPositions = Array.from(discoveredMap.values()).sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0));

      if (currentGeneration === fetchGeneration.current) {
        setPositions(finalPositions);
        persistDeFiPositions(targetAddress, finalPositions);
      }
    } catch (err) {
      console.error("DeFi discovery failed:", err);
      setError("Failed to discover DeFi positions");
    } finally {
      if (currentGeneration === fetchGeneration.current) {
        setLoading(false);
      }
      fetchInProgress.current = false;
    }
  }, [targetAddress, client, clientError, priceMap, (balances || []).length]);

  useEffect(() => {
    if (targetAddress) {
      void fetchPositions();
    }
  }, [targetAddress, fetchPositions]);

  return { positions, loading, error, refresh: () => fetchPositions({ force: true }) };
};
