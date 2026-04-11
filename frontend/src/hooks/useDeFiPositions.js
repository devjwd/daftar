import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useMovementClient } from "./useMovementClient";
import { ALL_ADAPTERS } from "../config/adapters/index";
import { DEFI_PROTOCOLS as PROTOCOL_REGISTRY } from "../config/protocols";

/**
 * =============================================================================
 * PRODUCTION-READY DEFI POSITION DETECTION ENGINE v2.0
 * =============================================================================
 * 
 * A comprehensive DeFi position scanner for Movement Network that:
 * 1. Fetches ALL account resources via RPC
 * 2. Uses intelligent pattern matching for protocol detection
 * 3. Recursively extracts values from complex Move struct data
 * 4. Supports both connected wallet and address search
 * 
 * Architecture:
 * - PROTOCOL_REGISTRY: Known DeFi protocol contract addresses
 * - DEFI_PATTERNS: Regex patterns to identify DeFi resource types
 * - Value extraction: Recursive traversal of Move struct data
 * - Deduplication: Prevents duplicate positions via type keys
 * 
 * Supported Protocols:
 * - Echelon Finance (Lending/Borrowing)
 * - Joule Finance (Lending/Borrowing)
 * - MovePosition (Lending/Borrowing)
 * - Meridian (CDP/Stablecoin)
 * - Canopy (Liquid Staking)
 * - LayerBank (Lending)
 * - Mosaic (DEX LP)
 * - Yuzu Swap (LP/CLMM)
 */

const devLog = (...args) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

const DEFI_POSITION_CACHE_TTL_MS = 2 * 60 * 1000;
const RESOURCE_CACHE_TTL_MS = 45 * 1000;
const ACCOUNT_TX_CACHE_TTL_MS = 5 * 60 * 1000;
const VIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFI_POSITION_CACHE_PREFIX = "movement_defi_positions_v1:";

const accountResourcesCache = new Map();
const accountTransactionsCache = new Map();
const viewResultCache = new Map();
const defiPositionsCache = new Map();

const getFreshCacheEntry = (cache, key, ttlMs) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.value !== undefined && (Date.now() - entry.cachedAt) < ttlMs) {
    return entry.value;
  }
  return null;
};

const getOrLoadCached = async (cache, key, ttlMs, loader) => {
  const cachedValue = getFreshCacheEntry(cache, key, ttlMs);
  if (cachedValue !== null) {
    return cachedValue;
  }

  const inFlight = cache.get(key);
  if (inFlight?.promise) {
    return inFlight.promise;
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      cache.set(key, {
        value,
        cachedAt: Date.now(),
      });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    promise,
    cachedAt: Date.now(),
  });

  return promise;
};

const loadPersistedDeFiPositions = (address) => {
  if (!address) return null;

  const memoryEntry = getFreshCacheEntry(defiPositionsCache, address, DEFI_POSITION_CACHE_TTL_MS);
  if (memoryEntry) {
    return memoryEntry;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${DEFI_POSITION_CACHE_PREFIX}${address}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.positions) || !Number.isFinite(parsed.cachedAt)) {
      return null;
    }

    if ((Date.now() - parsed.cachedAt) >= DEFI_POSITION_CACHE_TTL_MS) {
      return null;
    }

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

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(`${DEFI_POSITION_CACHE_PREFIX}${address}`, JSON.stringify(snapshot));
  } catch {
    // ignore storage failures
  }
};

const sortDetectedPositions = (positions = []) => {
  const typeOrder = {
    "Lending": 0, "Staking": 1, "Liquidity": 2,
    "Farming": 3, "Yield": 4, "CDP": 5, "Debt": 6, "DeFi": 7,
  };

  return [...positions].sort((a, b) => {
    const orderDiff = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return (b.numericValue || 0) - (a.numericValue || 0);
  });
};

const discoverNativeStakingPositions = async ({ client, targetAddress, protocolInfo }) => {
  const accountTxns = await getOrLoadCached(
    accountTransactionsCache,
    `account_tx:${targetAddress}`,
    ACCOUNT_TX_CACHE_TTL_MS,
    () => client.getAccountTransactions({
      accountAddress: targetAddress,
      options: { limit: 100 },
    })
  );

  const poolAddresses = new Set();

  for (const tx of accountTxns || []) {
    const fn = String(tx?.payload?.function || "").toLowerCase();
    if (!fn.startsWith("0x1::delegation_pool::")) continue;

    const args = tx?.payload?.arguments;
    const maybePool = String(Array.isArray(args) ? args[0] || "" : "").toLowerCase();
    if (/^0x[0-9a-f]+$/.test(maybePool)) {
      poolAddresses.add(maybePool);
    }
  }

  const poolResults = await Promise.all(
    Array.from(poolAddresses).map(async (poolAddress) => {
      try {
        const stakeResult = await client.view({
          payload: {
            function: "0x1::delegation_pool::get_stake",
            typeArguments: [],
            functionArguments: [poolAddress, targetAddress],
          },
        });

        const activeStakeRaw = Number(stakeResult?.[0] || 0);
        const inactiveStakeRaw = Number(stakeResult?.[1] || 0);
        const pendingActiveRaw = Number(stakeResult?.[2] || 0);

        let pendingWithdrawalRaw = 0;
        try {
          const pendingWithdrawalResult = await client.view({
            payload: {
              function: "0x1::delegation_pool::get_pending_withdrawal",
              typeArguments: [],
              functionArguments: [poolAddress, targetAddress],
            },
          });
          pendingWithdrawalRaw = Number(pendingWithdrawalResult?.[0] || 0);
        } catch {
          // optional path; some pools may return no pending withdrawal
        }

        const totalRaw = activeStakeRaw + inactiveStakeRaw + pendingActiveRaw + pendingWithdrawalRaw;
        const numericValue = totalRaw / 100000000;
        if (numericValue <= 0.0001) {
          return null;
        }

        devLog(`  ✅ Native staking: ${numericValue.toFixed(4)} MOVE @ ${poolAddress.slice(0, 12)}...`);

        return {
          id: `movement_native_staking_${poolAddress.slice(2, 10)}`,
          name: "Movement Native Staking",
          type: "Staking",
          value: numericValue.toFixed(4),
          numericValue,
          tokenSymbol: "MOVE",
          resourceType: `0x1::delegation_pool::get_stake<${poolAddress}>`,
          source: "view",
          protocol: protocolInfo,
          protocolName: protocolInfo.name,
          protocolWebsite: protocolInfo.website,
          stakedAmount: activeStakeRaw,
          pendingStakeAmount: inactiveStakeRaw + pendingActiveRaw,
          pendingWithdrawalAmount: pendingWithdrawalRaw,
          poolAddress,
        };
      } catch (poolError) {
        devLog(`  ⚠️ Could not read native stake for pool ${poolAddress.slice(0, 12)}...:`, poolError?.message || poolError);
        return null;
      }
    })
  );

  return poolResults.filter(Boolean);
};

// =============================================================================
// DEFI RESOURCE PATTERNS - Intelligent Pattern Matching
// =============================================================================
const DEFI_PATTERNS = [
  // Lending/Borrowing patterns - HIGH PRIORITY
  // Only match MovePosition portfolio specifically
  { regex: /0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::portfolio::/i, category: "Lending", priority: 1 },
  { regex: /::borrow::/i, category: "Debt", priority: 1 },
  { regex: /UserAccount/i, category: "Lending", priority: 1 },
  { regex: /UserPosition/i, category: "Lending", priority: 1 },
  { regex: /PositionInfo/i, category: "Lending", priority: 1 },
  { regex: /CollateralStore/i, category: "Lending", priority: 1 },
  { regex: /DebtStore/i, category: "Debt", priority: 1 },
  { regex: /Portfolio$/i, category: "Lending", priority: 1 },     // Direct portfolio match
  
  // LP/DEX patterns
  { regex: /::swap::/i, category: "Liquidity", priority: 2 },
  { regex: /::amm::/i, category: "Liquidity", priority: 2 },
  { regex: /::pool::/i, category: "Liquidity", priority: 2 },
  { regex: /LPCoin/i, category: "Liquidity", priority: 1 },
  { regex: /LPToken/i, category: "Liquidity", priority: 1 },
  { regex: /PoolToken/i, category: "Liquidity", priority: 2 },
  { regex: /UserPoolsMap/i, category: "Liquidity", priority: 2 },    // Meridian pools
  { regex: /UserPositionsMap/i, category: "Liquidity", priority: 2 },  // Pool positions
  
  // Staking patterns
  { regex: /::stake::/i, category: "Staking", priority: 1 },
  { regex: /::staking::/i, category: "Staking", priority: 1 },
  { regex: /StakeInfo/i, category: "Staking", priority: 1 },
  { regex: /UserStake/i, category: "Staking", priority: 1 },
  { regex: /stMOVE/i, category: "Staking", priority: 1 },
  { regex: /staked/i, category: "Staking", priority: 3 },
  
  // Farming patterns
  { regex: /::farm::/i, category: "Farming", priority: 1 },
  { regex: /::farming::/i, category: "Farming", priority: 1 },
  { regex: /::masterchef::/i, category: "Farming", priority: 1 },
  
  // Vault/Yield patterns
  { regex: /::vault::/i, category: "Yield", priority: 2 },
  { regex: /VaultShare/i, category: "Yield", priority: 1 },
  
  // CDP patterns
  { regex: /::cdp::/i, category: "CDP", priority: 1 },
  { regex: /Trove/i, category: "CDP", priority: 1 },
];

// =============================================================================
// RECEIPT TOKEN PATTERNS - Protocol-specific deposit tokens
// =============================================================================
const RECEIPT_TOKEN_PATTERNS = [
  { regex: /ecUSD|ecMOVE|ecWETH|ecWBTC|ecUSDT|ecUSDC/i, protocol: "ECHELON", category: "Lending" },
  { regex: /jUSD|jMOVE|jWETH|jWBTC/i, protocol: "JOULE", category: "Lending" },
  { regex: /stMOVE|sMOVE|cvMOVE|cvUSDC|cvUSDT|cvWBTC|cvWETH/i, protocol: "CANOPY", category: "Staking" },
  { regex: /mLP|mToken/i, protocol: "MOSAIC", category: "Liquidity" },
  { regex: /yLP|yToken/i, protocol: "YUZU", category: "Liquidity" },
];

// =============================================================================
// VALUE EXTRACTION ENGINE - Recursive Move struct value parser
// =============================================================================

/**
 * Recursively extracts numeric values from complex Move struct data
 * @param {Object} data - Move resource data
 * @param {number} maxDepth - Maximum recursion depth (prevents infinite loops)
 * @returns {Array<{field: string, value: number}>} - Extracted values
 */
const extractValuesRecursively = (data, maxDepth = 6, currentDepth = 0) => {
  if (currentDepth > maxDepth || !data || typeof data !== "object") {
    return [];
  }
  
  const values = [];
  const valueFields = [
    "value", "amount", "balance", "coin", "total", "shares",
    "deposited", "borrowed", "staked", "collateral", "principal", 
    "debt", "supply", "deposit_notes", "loan_notes", "supply_amount", 
    "borrow_amount", "available", "locked", "pending"
  ];
  
  // Check direct value fields
  for (const field of valueFields) {
    if (data[field] !== undefined) {
      const val = data[field];
      if (typeof val === "string" || typeof val === "number") {
        const num = Number(val);
        if (!isNaN(num) && num > 0) {
          values.push({ field, value: num, depth: currentDepth });
        }
      } else if (typeof val === "object" && val !== null) {
        // Nested object like { value: "123" }
        values.push(...extractValuesRecursively(val, maxDepth, currentDepth + 1));
      }
    }
  }
  
  // Check for array fields (collateral lists, position arrays)
  // MovePosition stores values directly in items array as strings/numbers
  const arrayFields = ["data", "inner", "items", "positions", "entries", "handle", "vec"];
  for (const field of arrayFields) {
    if (Array.isArray(data[field])) {
      data[field].forEach((item) => {
        // Handle direct numeric values in array (e.g., MovePosition's items: ["14967325692", "0"])
        if (typeof item === "string" || typeof item === "number") {
          const num = Number(item);
          if (!isNaN(num) && num > 0) {
            values.push({ field: `${field}[]`, value: num, depth: currentDepth });
          }
        } else if (typeof item === "object" && item !== null) {
          // Recurse into nested objects
          values.push(...extractValuesRecursively(item, maxDepth, currentDepth + 1));
        }
      });
    }
  }
  
  // Check all other object properties
  for (const [key, val] of Object.entries(data)) {
    if (!valueFields.includes(key) && !arrayFields.includes(key)) {
      if (typeof val === "object" && val !== null) {
        values.push(...extractValuesRecursively(val, maxDepth, currentDepth + 1));
      }
    }
  }
  
  return values;
};

/**
 * Calculate total value from resource data
 * @param {Object} data - Move resource data
 * @param {number} decimals - Token decimals (default 8 for Movement)
 * @returns {number} - Calculated value
 */
const calculateTotalValue = (data, decimals = 8) => {
  const extracted = extractValuesRecursively(data);
  if (extracted.length === 0) return 0;
  
  // Deduplicate by using the largest value at each depth level
  const valuesByDepth = {};
  extracted.forEach(({ value, depth }) => {
    if (!valuesByDepth[depth] || value > valuesByDepth[depth]) {
      valuesByDepth[depth] = value;
    }
  });
  
  // Use the highest depth value (most specific) or sum if multiple exist
  const totalRaw = Math.max(...Object.values(valuesByDepth));
  return totalRaw / Math.pow(10, decimals);
};

/**
 * Identify protocol from resource type string
 */
const identifyProtocol = (resourceType) => {
  const typeLower = resourceType.toLowerCase();
  
  for (const [key, protocol] of Object.entries(PROTOCOL_REGISTRY)) {
    // Check addresses
    for (const addr of protocol.addresses) {
      if (typeLower.includes(addr.toLowerCase())) {
        return { key, ...protocol };
      }
    }
    // Check keywords
    for (const keyword of protocol.keywords) {
      if (typeLower.includes(keyword.toLowerCase())) {
        return { key, ...protocol };
      }
    }
  }
  
  return null;
};

/**
 * Determine position category from resource type
 */
const categorizePosition = (resourceType, data) => {
  const typeLower = resourceType.toLowerCase();
  
  // Explicit debt indicators
  if (typeLower.includes("borrow") || typeLower.includes("debt") || typeLower.includes("loan")) {
    return "Debt";
  }
  
  // Check for debt in data
  if (data?.borrowed || data?.debt || data?.loan_notes) {
    const debtValue = calculateTotalValue({ value: data.borrowed || data.debt || data.loan_notes });
    if (debtValue > 0) return "Debt";
  }
  
  // Match against patterns (sorted by priority)
  const sortedPatterns = [...DEFI_PATTERNS].sort((a, b) => a.priority - b.priority);
  for (const { regex, category } of sortedPatterns) {
    if (regex.test(resourceType)) {
      return category;
    }
  }
  
  return "DeFi";
};

/**
 * Extract human-readable name from resource type
 */
const extractPositionName = (resourceType, protocol) => {
  const parts = resourceType.split("::");
  const lastPart = parts[parts.length - 1]?.replace(/[<>]/g, "").replace(/([A-Z])/g, " $1").trim() || "";
  
  if (protocol) {
    // Build descriptive name based on resource type
    if (lastPart.includes("Account") || lastPart.includes("Position")) {
      return `${protocol.name} Position`;
    }
    if (lastPart.includes("LP") || lastPart.includes("Pool")) {
      return `${protocol.name} LP`;
    }
    if (lastPart.includes("Stake") || lastPart.includes("staked")) {
      return `${protocol.name} Staked`;
    }
    if (lastPart.includes("Borrow") || lastPart.includes("Debt")) {
      return `${protocol.name} Debt`;
    }
    return `${protocol.name} ${lastPart}`;
  }
  
  // Generic extraction
  if (parts.length >= 2) {
    const moduleName = parts[parts.length - 2];
    return `${moduleName} ${lastPart}`.replace(/_/g, " ");
  }
  
  return lastPart || "DeFi Position";
};

const parsePositiveNumeric = (value) => {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isFinite(converted) && converted > 0 ? converted : 0;
  }

  if (typeof value === "string") {
    if (!/^\d+(\.\d+)?$/.test(value)) return 0;
    const converted = Number(value);
    return Number.isFinite(converted) && converted > 0 ? converted : 0;
  }

  if (typeof value === "object") {
    if (value.value !== undefined) return parsePositiveNumeric(value.value);
    if (value.amount !== undefined) return parsePositiveNumeric(value.amount);
    if (value.coin !== undefined) return parsePositiveNumeric(value.coin);
  }

  return 0;
};

const collectNumericFields = (node, fieldNames, maxDepth = 8, depth = 0) => {
  if (!node || depth > maxDepth) return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectNumericFields(item, fieldNames, maxDepth, depth + 1));
  }

  if (typeof node !== "object") {
    return [];
  }

  const values = [];
  for (const [key, value] of Object.entries(node)) {
    if (fieldNames.has(key)) {
      const numeric = parsePositiveNumeric(value);
      if (numeric > 0) {
        values.push(numeric);
      }
    }

    if (value && typeof value === "object") {
      values.push(...collectNumericFields(value, fieldNames, maxDepth, depth + 1));
    }
  }

  return values;
};

const sumNumericFields = (node, fields) => {
  const values = collectNumericFields(node, new Set(fields));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0);
};

// =============================================================================
// MAIN HOOK - useDeFiPositions
// =============================================================================

export const useDeFiPositions = (searchAddress = null) => {
  const { account, connected } = useWallet();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchInProgress = useRef(false);
  const lastFetchedAddress = useRef(null);
  const fetchGeneration = useRef(0);
  const { client, loading: clientLoading, error: clientError } = useMovementClient();

  /**
   * Normalize address from various wallet adapter formats
   */
  const normalizeAddress = useCallback((address) => {
    if (!address) return null;
    
    let normalized = address;
    
    // Handle wallet adapter AccountAddress objects
    if (typeof address === "object") {
      if (typeof address.toString === "function") {
        normalized = address.toString();
      } else if (typeof address.hex === "function") {
        normalized = address.hex();
      } else if (address.data && typeof address.data === "object") {
        const hex = Array.from(address.data)
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");
        normalized = `0x${hex}`;
      }
    }
    
    normalized = String(normalized).trim();
    
    // Ensure 0x prefix
    if (!normalized.startsWith("0x") && /^[a-fA-F0-9]+$/.test(normalized)) {
      normalized = `0x${normalized}`;
    }
    
    return normalized.toLowerCase();
  }, []);

  /**
   * Target address: search address takes priority over connected wallet
   */
  const targetAddress = useMemo(() => {
    if (searchAddress) {
      return normalizeAddress(searchAddress);
    }
    if (connected && account?.address) {
      return normalizeAddress(account.address);
    }
    return null;
  }, [searchAddress, connected, account, normalizeAddress]);

  /**
   * Main fetch function - scans account resources for DeFi positions
   */
  const fetchPositions = useCallback(async (options = {}) => {
    const forceRefresh = options.force === true;

    if (!targetAddress) {
      setPositions([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!client) {
      setLoading(false);
      if (clientError) {
        setError(clientError.message || "Failed to load Movement client");
      }
      return;
    }

    // Prevent concurrent/duplicate fetches
    if (fetchInProgress.current) {
      if (import.meta.env.DEV) {
        console.log("⏳ DeFi scan already in progress, skipping...");
      }
      return;
    }
    
    const cachedSnapshot = loadPersistedDeFiPositions(targetAddress);
    const hasFreshCachedPositions = Boolean(cachedSnapshot?.positions?.length);

    if (hasFreshCachedPositions && !forceRefresh) {
      lastFetchedAddress.current = targetAddress;
      setPositions(cachedSnapshot.positions);
      setError(null);
      setLoading(false);
      return;
    }

    // Check if we're fetching a different address - if so, clear cache
    if (lastFetchedAddress.current !== targetAddress) {
      if (import.meta.env.DEV) {
        console.log("🔄 New address detected, clearing cache...");
      }
      if (hasFreshCachedPositions) {
        setPositions(cachedSnapshot.positions);
      } else {
        setPositions([]);
      }
    }
    
    // Note: removed stale cache check — the useEffect guards against unnecessary re-fetches
    // The refetch function should always fetch fresh data when called explicitly

    fetchInProgress.current = true;
    lastFetchedAddress.current = targetAddress;
    fetchGeneration.current += 1;
    const currentFetchGeneration = fetchGeneration.current;
    setLoading(true);
    setError(null);

    if (import.meta.env.DEV) {
      console.log("═══════════════════════════════════════════════════════════════════");
      console.log("🔍 DEFI POSITION SCANNER v2.0 - Starting scan");
      console.log("═══════════════════════════════════════════════════════════════════");
      console.log("📍 Target Address:", targetAddress);
    }

    try {
      // Fetch all account resources via RPC
      const resources = await getOrLoadCached(
        accountResourcesCache,
        `resources:${targetAddress}`,
        RESOURCE_CACHE_TTL_MS,
        () => client.getAccountResources({
          accountAddress: targetAddress,
        })
      );

      if (import.meta.env.DEV) {
        console.log(`📦 Total resources fetched: ${resources.length}`);
        
        // Debug: Log all Meridian resources
        const meridianResources = resources.filter(r => 
          r.type.includes("8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82") ||
          (r.type.includes("swap") && r.type.includes("LPCoin"))
        );
        if (meridianResources.length > 0) {
          console.log(`\n🔷 MERIDIAN RESOURCES SUMMARY: ${meridianResources.length} found`);
          meridianResources.forEach((res, idx) => {
            console.log(`  [${idx+1}] ${res.type.substring(0, 100)}...`);
          });
        }
        
        // Extra debug: Find ANY resources with "pool" or "position" keywords
        const poolResources = resources.filter(r => 
          r.type.toLowerCase().includes("pool") || 
          r.type.toLowerCase().includes("position") ||
          r.type.toLowerCase().includes("liquidity")
        );
        if (poolResources.length > 0) {
          console.log(`\n🏊 POOL/POSITION RESOURCES: ${poolResources.length} found`);
          poolResources.forEach((res, idx) => {
            console.log(`  [${idx+1}] ${res.type.substring(0, 120)}...`);
          });
        }
      }

      // Initialize detection arrays
      const detectedPositions = [];
      const processedTypes = new Set();
      
      // =================================================================
      // PHASE 1: Scan for DeFi protocol resources
      // =================================================================
      if (import.meta.env.DEV) {
        console.log("\n📊 PHASE 1: Scanning for DeFi resources...");
      }
      
      for (const resource of resources) {
        const resourceType = resource.type;
        const resourceData = resource.data;
        
        // Skip standard coin stores (handled by balance fetcher) unless they're receipt tokens or LP coins
        if (resourceType.includes("0x1::coin::CoinStore")) {
          // Special handling for LP/DEX coins - let them pass to adapter matching
          const isLPCoin = /::swap::LPCoin|::amm::|::pool::|LPCoin|LPToken/i.test(resourceType);
          
          if (!isLPCoin) {
            // Check if it's a receipt token
            let isReceiptToken = false;
            for (const { regex, protocol, category } of RECEIPT_TOKEN_PATTERNS) {
              if (regex.test(resourceType)) {
                isReceiptToken = true;
                const value = calculateTotalValue(resourceData);
                if (value > 0) {
                  const typeKey = `receipt_${protocol}_${resourceType.substring(0, 50)}`;
                  if (!processedTypes.has(typeKey)) {
                    processedTypes.add(typeKey);
                    const protocolInfo = PROTOCOL_REGISTRY[protocol];
                    
                    devLog(`  ✅ Receipt Token: ${protocolInfo?.name || protocol}`);
                    
                    detectedPositions.push({
                      id: `${protocol.toLowerCase()}_receipt_${detectedPositions.length}`,
                      name: `${protocolInfo?.name || protocol} Deposit`,
                      type: category,
                      value: value.toFixed(4),
                      numericValue: value,
                      resourceType: resourceType,
                      source: "rpc",
                      protocol: protocolInfo || null,
                      protocolName: protocolInfo?.name || protocol,
                      protocolWebsite: protocolInfo?.website || null,
                    });
                  }
                }
                break;
              }
            }
            if (!isReceiptToken) continue;
          }
          // If isLPCoin, continue to adapter matching (don't skip)
        }
        
        // Check if this is a DeFi resource via patterns
        const isDeFiResource = DEFI_PATTERNS.some(({ regex }) => regex.test(resourceType));
        
        // Also check via protocol registry
        const protocol = identifyProtocol(resourceType);
        
        if (!isDeFiResource && !protocol) {
          continue; // Not a DeFi resource
        }
        
        // Prevent duplicates using base type (without generics)
        const typeKey = resourceType.split("<")[0];
        if (processedTypes.has(typeKey)) {
          continue;
        }
        
        // =============================================================
        // SPECIAL HANDLER: MovePosition Portfolio (collaterals + liabilities)
        // Uses view functions to convert notes to actual token amounts
        // =============================================================
        if (resourceType.includes("::portfolio::Portfolio")) {
          processedTypes.add(typeKey);
          
          const MOVEPOSITION_CONTRACT = "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf";
          
          // Helper to decode hex-encoded token name and get full coin type
          const decodeTokenInfo = (hexString) => {
            try {
              if (!hexString || !hexString.startsWith("0x")) return null;
              const hex = hexString.slice(2);
              let decoded = "";
              for (let i = 0; i < hex.length; i += 2) {
                decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
              }
              // Extract token from "DepositNote<...::coins::MOVE>" or "LoanNote<...::coins::USDC>"
              const match = decoded.match(/::coins::(\w+)>/);
              if (match) {
                const symbol = match[1];
                const coinType = `${MOVEPOSITION_CONTRACT}::coins::${symbol}`;
                return { symbol, coinType };
              }
              return null;
            } catch {
              return null;
            }
          };
          
          // Helper to get decimals for token
          const getDecimals = (tokenName) => {
            const upper = tokenName.toUpperCase();
            if (upper === "USDC" || upper === "USDT" || upper === "USDt") return 6;
            return 8; // MOVE, WETH, WBTC, RSETH, etc.
          };
          
          // Process collateral (supply) positions with view function calls
          const collateralItems = resourceData?.collaterals?.items || [];
          const collateralKeys = resourceData?.collaterals?.keys?.items || [];
          
          const collateralResults = await Promise.all(
            collateralKeys.map(async (collateralKey, index) => {
              const rawNotes = collateralItems[index];
              if (!rawNotes || Number(rawNotes) <= 0) return null;

              const tokenInfo = decodeTokenInfo(collateralKey?.struct_name);
              if (!tokenInfo) return null;

              try {
                const result = await client.view({
                  payload: {
                    function: `${MOVEPOSITION_CONTRACT}::broker::calc_coins_from_dnotes`,
                    typeArguments: [tokenInfo.coinType],
                    functionArguments: [rawNotes]
                  }
                });

                const actualAmount = Number(result[0]);
                const decimals = getDecimals(tokenInfo.symbol);
                const value = actualAmount / Math.pow(10, decimals);

                if (value < 0.001) return null;

                devLog(`  ✅ Found: MovePosition Supply - ${tokenInfo.symbol}`);
                devLog(`     Notes: ${rawNotes} → Actual: ${value.toFixed(4)} ${tokenInfo.symbol}`);

                return {
                  idPrefix: `moveposition_supply_${tokenInfo.symbol.toLowerCase()}`,
                  name: `MovePosition Supply`,
                  type: "Lending",
                  value: value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: tokenInfo.symbol,
                  resourceType: resourceType,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.MOVEPOSITION,
                  protocolName: "MovePosition",
                  protocolWebsite: "https://moveposition.xyz",
                };
              } catch (err) {
                devLog(`  ⚠️ Could not get actual value for ${tokenInfo.symbol}:`, err.message);
                return null;
              }
            })
          );

          collateralResults.filter(Boolean).forEach((position) => {
            detectedPositions.push({
              ...position,
              id: `${position.idPrefix}_${detectedPositions.length}`,
            });
          });
          
          // Process liability (borrow) positions with view function calls
          const liabilityItems = resourceData?.liabilities?.items || [];
          const liabilityKeys = resourceData?.liabilities?.keys?.items || [];
          
          const liabilityResults = await Promise.all(
            liabilityKeys.map(async (liabilityKey, index) => {
              const rawNotes = liabilityItems[index];
              if (!rawNotes || Number(rawNotes) <= 0) return null;

              const tokenInfo = decodeTokenInfo(liabilityKey?.struct_name);
              if (!tokenInfo) return null;

              try {
                const result = await client.view({
                  payload: {
                    function: `${MOVEPOSITION_CONTRACT}::broker::calc_coins_from_lnotes`,
                    typeArguments: [tokenInfo.coinType],
                    functionArguments: [rawNotes]
                  }
                });

                const actualAmount = Number(result[0]);
                const decimals = getDecimals(tokenInfo.symbol);
                const value = actualAmount / Math.pow(10, decimals);

                if (value < 0.001) return null;

                devLog(`  ✅ Found: MovePosition Debt - ${tokenInfo.symbol}`);
                devLog(`     Notes: ${rawNotes} → Actual: ${value.toFixed(4)} ${tokenInfo.symbol}`);

                return {
                  idPrefix: `moveposition_debt_${tokenInfo.symbol.toLowerCase()}`,
                  name: `MovePosition Debt`,
                  type: "Debt",
                  value: value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: tokenInfo.symbol,
                  resourceType: resourceType,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.MOVEPOSITION,
                  protocolName: "MovePosition",
                  protocolWebsite: "https://moveposition.xyz",
                };
              } catch (err) {
                devLog(`  ⚠️ Could not get actual value for ${tokenInfo.symbol}:`, err.message);
                return null;
              }
            })
          );

          liabilityResults.filter(Boolean).forEach((position) => {
            detectedPositions.push({
              ...position,
              id: `${position.idPrefix}_${detectedPositions.length}`,
            });
          });
          
          continue; // Move to next resource
        }
        
        // =============================================================
        // SPECIAL HANDLER: Echelon Lending Vault (collaterals + liabilities)
        // Uses view functions to get actual coin amounts
        // =============================================================
        if (resourceType.includes("::lending::Vault") && resourceType.includes("0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5")) {
          processedTypes.add(typeKey);
          
          const ECHELON_CONTRACT = "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5";
          
          // Only include supported Echelon assets and keep exact token identities
          const ECHELON_SUPPORTED_ASSETS = new Set([
            "MOVE", "WETH", "RSETH", "USDC", "USDT", "SUSDE", "WBTC", "LBTC", "SOLVBTC", "EZETH"
          ]);

          // Helper to get decimals and symbol from market asset name
          const getAssetInfo = (assetName) => {
            const normalized = String(assetName || "").trim();
            const nameUpper = normalized.toUpperCase();

            // Specific mappings first (avoid collapsing all BTC/ETH to one symbol)
            if (nameUpper.includes("SUSDE")) return { symbol: "sUSDe", decimals: 6, supported: true };
            if (nameUpper.includes("USDC")) return { symbol: "USDC", decimals: 6, supported: true };
            if (nameUpper.includes("USDT") || nameUpper.includes("USDT.E")) return { symbol: "USDT", decimals: 6, supported: true };

            if (nameUpper.includes("RSETH")) return { symbol: "rsETH", decimals: 8, supported: true };
            if (nameUpper.includes("EZETH")) return { symbol: "ezETH", decimals: 8, supported: true };
            if (nameUpper.includes("WETH")) return { symbol: "WETH", decimals: 8, supported: true };

            if (nameUpper.includes("SOLVBTC")) return { symbol: "SolvBTC", decimals: 8, supported: true };
            if (nameUpper.includes("LBTC")) return { symbol: "LBTC", decimals: 8, supported: true };
            if (nameUpper.includes("WBTC") || nameUpper.includes("WBTC.E")) return { symbol: "WBTC", decimals: 8, supported: true };

            if (nameUpper.includes("MOVE") || nameUpper.includes("APTOS")) return { symbol: "MOVE", decimals: 8, supported: true };

            const fallbackSymbol = normalized || "UNKNOWN";
            return {
              symbol: fallbackSymbol,
              decimals: 8,
              supported: ECHELON_SUPPORTED_ASSETS.has(fallbackSymbol.toUpperCase()),
            };
          };
          
          // Process collateral (supply) positions
          const collateralData = resourceData?.collaterals?.data || [];
          
          const collateralResults = await Promise.all(
            collateralData.map(async (collateral) => {
              const marketAddr = collateral?.key?.inner;
              const shares = collateral?.value;

              if (!marketAddr || !shares || Number(shares) <= 0) return null;

              try {
                const nameResult = await getOrLoadCached(
                  viewResultCache,
                  `echelon_market_name:${marketAddr}`,
                  VIEW_CACHE_TTL_MS,
                  () => client.view({
                    payload: {
                      function: `${ECHELON_CONTRACT}::lending::market_asset_name`,
                      typeArguments: [],
                      functionArguments: [marketAddr]
                    }
                  })
                );
                const assetName = nameResult[0] || "Unknown";
                const { symbol, decimals, supported } = getAssetInfo(assetName);
                if (!supported) return null;

                const coinsResult = await client.view({
                  payload: {
                    function: `${ECHELON_CONTRACT}::lending::account_coins`,
                    typeArguments: [],
                    functionArguments: [targetAddress, marketAddr]
                  }
                });

                const actualAmount = Number(coinsResult[0]);
                const value = actualAmount / Math.pow(10, decimals);
                if (value <= 0) return null;

                devLog(`  ✅ Found: Echelon Supply - ${symbol}`);
                devLog(`     Shares: ${shares} → Actual: ${value.toFixed(4)} ${symbol}`);

                return {
                  idPrefix: `echelon_supply_${symbol.toLowerCase()}`,
                  name: `Echelon Supply`,
                  type: "Lending",
                  value: value < 0.01 ? value.toFixed(8) : value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: symbol,
                  resourceType: resourceType,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.ECHELON,
                  protocolName: "Echelon",
                  protocolWebsite: "https://app.echelon.market",
                };
              } catch (err) {
                devLog(`  ⚠️ Could not get Echelon supply for market ${marketAddr}:`, err.message);
                return null;
              }
            })
          );

          collateralResults.filter(Boolean).forEach((position) => {
            detectedPositions.push({
              ...position,
              id: `${position.idPrefix}_${detectedPositions.length}`,
            });
          });
          
          // Process liability (borrow) positions
          const liabilityData = resourceData?.liabilities?.data || [];
          
          const liabilityResults = await Promise.all(
            liabilityData.map(async (liability) => {
              const marketAddr = liability?.key?.inner;
              const liabilityInfo = liability?.value;
              const principal = liabilityInfo?.principal;

              if (!marketAddr || !principal || Number(principal) <= 0) return null;

              try {
                const nameResult = await getOrLoadCached(
                  viewResultCache,
                  `echelon_market_name:${marketAddr}`,
                  VIEW_CACHE_TTL_MS,
                  () => client.view({
                    payload: {
                      function: `${ECHELON_CONTRACT}::lending::market_asset_name`,
                      typeArguments: [],
                      functionArguments: [marketAddr]
                    }
                  })
                );
                const assetName = nameResult[0] || "Unknown";
                const { symbol, decimals, supported } = getAssetInfo(assetName);
                if (!supported) return null;

                const debtResult = await client.view({
                  payload: {
                    function: `${ECHELON_CONTRACT}::lending::account_liability`,
                    typeArguments: [],
                    functionArguments: [targetAddress, marketAddr]
                  }
                });

                const actualDebt = Number(debtResult[0]);
                const value = actualDebt / Math.pow(10, decimals);
                if (value <= 0) return null;

                devLog(`  ✅ Found: Echelon Debt - ${symbol}`);
                devLog(`     Principal: ${principal} → Actual: ${value.toFixed(4)} ${symbol}`);

                return {
                  idPrefix: `echelon_debt_${symbol.toLowerCase()}`,
                  name: `Echelon Debt`,
                  type: "Debt",
                  value: value < 0.01 ? value.toFixed(8) : value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: symbol,
                  resourceType: resourceType,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.ECHELON,
                  protocolName: "Echelon",
                  protocolWebsite: "https://app.echelon.market",
                };
              } catch (err) {
                devLog(`  ⚠️ Could not get Echelon debt for market ${marketAddr}:`, err.message);
                return null;
              }
            })
          );

          liabilityResults.filter(Boolean).forEach((position) => {
            detectedPositions.push({
              ...position,
              id: `${position.idPrefix}_${detectedPositions.length}`,
            });
          });
          
          continue; // Move to next resource
        }
        
        // =============================================================
        // SPECIAL HANDLER: Joule Finance Lending Protocol
        // Resource: 0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::pool::UserPositionsMap
        // Contains lend_positions and borrow_positions
        // =============================================================
        const JOULE_CONTRACT = "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2";
        
        if (resourceType.includes(`${JOULE_CONTRACT}::pool::UserPositionsMap`)) {
          processedTypes.add(typeKey);
          devLog("  🏦 Processing Joule Finance positions...");
          
          // Token map for Joule
          const JOULE_TOKEN_MAP = {
            "0x1::aptos_coin::AptosCoin": { symbol: "MOVE", decimals: 8 },
            "0xa": { symbol: "MOVE", decimals: 8 },
            // Add more token mappings as needed
          };
          
          // Helper to get token info from coin type
          const getJouleTokenInfo = (coinType) => {
            if (JOULE_TOKEN_MAP[coinType]) return JOULE_TOKEN_MAP[coinType];
            
            // Extract symbol from coin type like "0x1::aptos_coin::AptosCoin"
            const parts = coinType.split("::");
            const symbol = parts[parts.length - 1] || "Unknown";
            const normalizedSymbol = symbol === "AptosCoin" ? "MOVE" : symbol;
            
            // Determine decimals based on token
            const upper = normalizedSymbol.toUpperCase();
            const decimals = (upper === "USDC" || upper === "USDT" || upper === "USDt") ? 6 : 8;
            
            return { symbol: normalizedSymbol, decimals };
          };
          
          // Process UserPositionsMap
          const positionsMap = resourceData?.positions_map?.data || [];
          
          for (const position of positionsMap) {
            const positionValue = position?.value;
            const positionName = positionValue?.position_name || "Position";
            
            // Process lending positions
            const lendPositions = positionValue?.lend_positions?.data || [];
            for (const lend of lendPositions) {
              const coinType = lend.key;
              const amount = Number(lend.value || 0);
              
              if (amount > 0) {
                const { symbol, decimals } = getJouleTokenInfo(coinType);
                const value = amount / Math.pow(10, decimals);
                
                if (value >= 0.0001) {  // Skip dust
                  devLog(`  ✅ Joule Supply: ${value.toFixed(4)} ${symbol}`);
                  
                  detectedPositions.push({
                    id: `joule_supply_${symbol.toLowerCase()}_${detectedPositions.length}`,
                    name: `Joule Supply`,
                    type: "Lending",
                    value: value.toFixed(4),
                    numericValue: value,
                    tokenSymbol: symbol,
                    resourceType: resourceType,
                    source: "rpc",
                    protocol: PROTOCOL_REGISTRY.JOULE,
                    protocolName: "Joule Finance",
                    protocolWebsite: "https://app.joule.finance",
                    positionName: positionName,
                  });
                }
              }
            }
            
            // Process borrowing positions
            const borrowPositions = positionValue?.borrow_positions?.data || [];
            for (const borrow of borrowPositions) {
              const coinType = borrow.key;
              const borrowData = borrow.value;
              const amount = Number(borrowData?.borrow_amount || 0);
              
              if (amount > 0) {
                const { symbol, decimals } = getJouleTokenInfo(coinType);
                const value = amount / Math.pow(10, decimals);
                
                if (value >= 0.0001) {  // Skip dust
                  devLog(`  ✅ Joule Debt: ${value.toFixed(4)} ${symbol}`);
                  
                  detectedPositions.push({
                    id: `joule_debt_${symbol.toLowerCase()}_${detectedPositions.length}`,
                    name: `Joule Debt`,
                    type: "Debt",
                    value: value.toFixed(4),
                    numericValue: value,
                    tokenSymbol: symbol,
                    resourceType: resourceType,
                    source: "rpc",
                    protocol: PROTOCOL_REGISTRY.JOULE,
                    protocolName: "Joule Finance",
                    protocolWebsite: "https://app.joule.finance",
                    positionName: positionName,
                    interestAccumulated: Number(borrowData?.interest_accumulated || 0),
                  });
                }
              }
            }
          }
          
          continue; // Move to next resource
        }
        
        // =============================================================
        // DEFAULT HANDLER: Generic DeFi resource
        // =============================================================
        
        // Extract value from resource data
        const value = calculateTotalValue(resourceData);
        
        // Skip zero-value positions
        if (value <= 0) {
          devLog(`  ⚪ Zero-value: ${resourceType.substring(0, 60)}...`);
          continue;
        }
        
        processedTypes.add(typeKey);
        
        // Categorize and name the position
        const category = categorizePosition(resourceType, resourceData);
        const positionName = extractPositionName(resourceType, protocol);
        
        devLog(`  ✅ Found: ${positionName}`);
        devLog(`     Type: ${category} | Value: ${value.toFixed(4)} | Protocol: ${protocol?.name || "Unknown"}`);
        
        detectedPositions.push({
          id: `${protocol?.key?.toLowerCase() || "defi"}_${category.toLowerCase()}_${detectedPositions.length}`,
          name: positionName,
          type: category,
          value: value.toFixed(4),
          numericValue: value,
          resourceType: resourceType,
          source: "rpc",
          protocol: protocol || null,
          protocolName: protocol?.name || "DeFi",
          protocolWebsite: protocol?.website || null,
          rawData: resourceData,
        });
      }

      // =================================================================
      // PHASE 1.5: LayerBank standalone view-function scan
      // (runs once per address, independent of resource loop)
      // =================================================================
      {
        const LAYERBANK_CONTRACT = "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea";
        devLog("  🏦 Scanning LayerBank positions...");
        
        try {
          const reservesResult = await getOrLoadCached(
            viewResultCache,
            `layerbank_reserves:${targetAddress}`,
            RESOURCE_CACHE_TTL_MS,
            () => client.view({
              payload: {
                function: `${LAYERBANK_CONTRACT}::pool_data_provider::get_user_all_reserves_data`,
                typeArguments: [],
                functionArguments: [targetAddress]
              }
            })
          );
          
          const TOKEN_MAP = {
            "0xa": { symbol: "MOVE", decimals: 8 },
            "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": { symbol: "USDC", decimals: 6 },
            "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": { symbol: "USDT", decimals: 6 },
            "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376": { symbol: "WETH", decimals: 8 },
            "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c": { symbol: "WBTC", decimals: 8 },
          };
          
          const reserves = reservesResult[0] || [];
          
          for (const reserve of reserves) {
            const supplyBalance = Number(reserve.current_a_token_balance || 0);
            const debtBalance = Number(reserve.current_variable_debt || 0);
            const reserveAddr = reserve.reserve_address;
            const tokenInfo = TOKEN_MAP[reserveAddr] || { symbol: "UNKNOWN", decimals: 8 };
            const { symbol, decimals } = tokenInfo;
            
            if (supplyBalance > 0) {
              const value = supplyBalance / Math.pow(10, decimals);
              if (value >= 0.0001) {
                detectedPositions.push({
                  id: `layerbank_supply_${symbol.toLowerCase()}_${detectedPositions.length}`,
                  name: `LayerBank Supply`,
                  type: "Lending",
                  value: value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: symbol,
                  resourceType: `${LAYERBANK_CONTRACT}::pool::Supply<${reserveAddr}>`,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.LAYERBANK,
                  protocolName: "LayerBank",
                  protocolWebsite: "https://app.layerbank.finance",
                });
              }
            }
            
            if (debtBalance > 0) {
              const value = debtBalance / Math.pow(10, decimals);
              if (value >= 0.0001) {
                detectedPositions.push({
                  id: `layerbank_debt_${symbol.toLowerCase()}_${detectedPositions.length}`,
                  name: `LayerBank Debt`,
                  type: "Debt",
                  value: value.toFixed(4),
                  numericValue: value,
                  tokenSymbol: symbol,
                  resourceType: `${LAYERBANK_CONTRACT}::pool::Debt<${reserveAddr}>`,
                  source: "rpc",
                  protocol: PROTOCOL_REGISTRY.LAYERBANK,
                  protocolName: "LayerBank",
                  protocolWebsite: "https://app.layerbank.finance",
                });
              }
            }
          }
        } catch (err) {
          devLog(`  ⚠️ LayerBank scan error:`, err.message);
        }
      }

      // Native staking is fetched after the first DeFi render so the initial card paint
      // isn't blocked by account transaction history + delegation pool lookups.

      // =================================================================
      // PHASE 1.75: Generic Adapter-Based Position Detection
      // Processes resources using ALL_ADAPTERS patterns for protocols
      // like Yuzu, Mosaic, Canopy, Meridian, Razor, etc.
      // =================================================================
      devLog("\n  🔌 Scanning with protocol adapters...");
      
      for (const resource of resources) {
        const resourceType = resource.type;
        const resourceData = resource.data;
        
        // Enhanced debug logging for all Meridian resources
        if (resourceType.includes("8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82")) {
          devLog(`  🔷 MERIDIAN RESOURCE:`);
          devLog(`     Type: ${resourceType.substring(0, 120)}...`);
          devLog(`     Data keys: ${Object.keys(resourceData).join(", ")}`);
        }
        
        // Specific logging for UserPoolsMap and UserPositionsMap
        if (resourceType.includes("UserPoolsMap") || resourceType.includes("UserPositionsMap")) {
          devLog(`  🎯 MERIDIAN POSITION RESOURCE FOUND`);
          devLog(`     Type: ${resourceType.substring(0, 150)}`);
          devLog(`     Keys: ${Object.keys(resourceData).join(", ")}`);
          if (resourceData.data) {
            devLog(`     Has data array: length=${Array.isArray(resourceData.data) ? resourceData.data.length : "not-array"}`);
          }
        }
        
        // Check each adapter for a match
        for (const adapter of ALL_ADAPTERS) {
          if (!adapter.searchString || !adapter.parse) continue;

          if (
            adapter.id === "movement_native_staking" &&
            detectedPositions.some((position) => position.source === "view" && position.protocolName === "Movement Native Staking")
          ) {
            continue;
          }
          
          // Check if resource type matches the adapter's search pattern
          if (resourceType.includes(adapter.searchString)) {
            if (typeof adapter.filterType === "function" && !adapter.filterType(resourceType)) {
              continue;
            }

            try {
              const parsedValue = adapter.parse(resourceData);
              
              // Debug for Meridian adapters
              if (adapter.id.includes("meridian")) {
                devLog(`  ✨ Meridian adapter matched: ${adapter.id}`);
                devLog(`     Resource: ${resourceType.substring(0, 100)}...`);
                devLog(`     Parsed value: ${parsedValue}`);
              }
              
              // Handle array returns from adapters (e.g., MovePosition with multiple tokens)
              if (Array.isArray(parsedValue)) {
                // Process each token position in the array
                parsedValue.forEach((tokenPosition) => {
                  const numericValue = tokenPosition.amount ? 
                    tokenPosition.amount / Math.pow(10, tokenPosition.decimals) : 
                    parseFloat(tokenPosition.formattedAmount || 0);
                  
                  // Accept any positive amount (even tiny amounts like 0.00000001 BTC)
                  if (numericValue <= 0) {
                    return;
                  }
                  
                  // Determine protocol from adapter ID
                  const protocolKey = adapter.id.split('_')[0].toUpperCase();
                  const protocol = PROTOCOL_REGISTRY[protocolKey] || null;
                  
                  devLog(`  ✅ Adapter Match: ${adapter.name} - ${tokenPosition.symbol} (${adapter.type})`);
                  devLog(`     Value: ${numericValue} ${tokenPosition.symbol}`);
                  
                  detectedPositions.push({
                    id: `${adapter.id}_${tokenPosition.symbol.toLowerCase()}_${detectedPositions.length}`,
                    name: `${adapter.name} (${tokenPosition.symbol})`,
                    type: adapter.type,
                    value: numericValue.toFixed(6),
                    numericValue: numericValue,
                    tokenSymbol: tokenPosition.symbol,
                    coinType: tokenPosition.coinType,
                    resourceType: resourceType,
                    source: "adapter",
                    protocol: protocol,
                    protocolName: protocol?.name || adapter.protocol || adapter.name.split(' ')[0],
                    protocolWebsite: protocol?.website || null,
                  });
                });
                
                // Continue to next resource after processing array
                break;
              }
              
              // Skip if parser returns null, undefined, or "0" (string type)
              if (!parsedValue || parsedValue === "0" || parsedValue === "0.0000") {
                if (adapter.id.includes("meridian")) {
                  devLog(`     ⚠️ Skipped (zero value or parsing issue)`);
                }
                continue;
              }
              
              // Convert parsed value to number for sorting (string type)
              const numericValue = parseFloat(parsedValue.replace(/,/g, '')) || 0;
              
              // Skip zero/dust values
              if (numericValue <= 0 || numericValue < 0.0001) {
                if (adapter.id.includes("meridian")) {
                  devLog(`     ⚠️ Skipped (dust value: ${numericValue})`);
                }
                continue;
              }
              
              // Determine protocol from adapter ID
              const protocolKey = adapter.id.split('_')[0].toUpperCase();
              const protocol = PROTOCOL_REGISTRY[protocolKey] || null;
              
              // Extract additional metadata for Meridian positions
              let additionalData = {};
              if (adapter.id.includes("meridian")) {
                const liquidityX = sumNumericFields(resourceData, [
                  "liquidity_x", "coin_x_amount", "token_x_amount", "x_amount", "amount_x", "token0_amount", "amount_0", "reserve_x"
                ]);
                const liquidityY = sumNumericFields(resourceData, [
                  "liquidity_y", "coin_y_amount", "token_y_amount", "y_amount", "amount_y", "token1_amount", "amount_1", "reserve_y"
                ]);
                let stakedTotal = sumNumericFields(resourceData, [
                  "staked", "staked_amount", "deposit", "deposited", "stake", "stake_amount", "lp_amount", "shares"
                ]);
                let liquidityTokenTotal = sumNumericFields(resourceData, [
                  "lp_amount", "liquidity", "shares", "amount", "stake_amount", "staked_amount"
                ]);

                if (!stakedTotal && (adapter.id.includes("staking") || adapter.id.includes("userpools") || adapter.id.includes("userpositions"))) {
                  stakedTotal = Math.round(numericValue * 1_000_000);
                }
                if (!liquidityTokenTotal && (adapter.id.includes("userpools") || adapter.id.includes("userpositions") || adapter.id.includes("position"))) {
                  liquidityTokenTotal = Math.round(numericValue * 1_000_000);
                }

                if (liquidityX > 0) {
                  additionalData.liquidityX = liquidityX;
                  additionalData.coinXAmount = liquidityX;
                }
                if (liquidityY > 0) {
                  additionalData.liquidityY = liquidityY;
                  additionalData.coinYAmount = liquidityY;
                }
                if (stakedTotal > 0) {
                  additionalData.stakedAmount = stakedTotal;
                }
                if (liquidityTokenTotal > 0) {
                  additionalData.liquidityTokens = liquidityTokenTotal;
                }

                if (resourceData.pool_id !== undefined) {
                  additionalData.poolId = resourceData.pool_id;
                }
                // Try to extract pool composition from resource type
                const typeMatch = resourceType.match(/swap::(\w+)<([^,]+),\s*([^>]+)>/);
                if (typeMatch) {
                  additionalData.tokenX = typeMatch[2].split("::").pop();
                  additionalData.tokenY = typeMatch[3].split("::").pop();
                }
              }
              
              devLog(`  ✅ Adapter Match: ${adapter.name} (${adapter.type})`);
              devLog(`     Value: ${parsedValue} | Pattern: ${adapter.searchString}`);
              
              if (adapter.id.includes("meridian")) {
                devLog('     🔷 Meridian Adapter additionalData:', additionalData);
              }
              
              detectedPositions.push({
                id: `${adapter.id}_${detectedPositions.length}`,
                name: adapter.name,
                type: adapter.type,
                value: parsedValue,
                numericValue: numericValue,
                resourceType: resourceType,
                source: "adapter",
                protocol: protocol,
                protocolName: protocol?.name || adapter.name.split(' ')[0],
                protocolWebsite: protocol?.website || null,
                ...additionalData  // Spread additional data fields
              });
              
              // Only use first matching adapter per resource
              break;
            } catch (err) {
              devLog(`  ⚠️ Adapter ${adapter.id} parse error:`, err.message);
            }
          }
        }
      }

      // =================================================================
      // PHASE 2: Sort positions by type and value
      // =================================================================
      const sortedPositions = sortDetectedPositions(detectedPositions);

      devLog("\n═══════════════════════════════════════════════════════════════════");
      devLog(`🎯 SCAN COMPLETE: Found ${sortedPositions.length} DeFi positions`);
      devLog("═══════════════════════════════════════════════════════════════════\n");

      setPositions(sortedPositions);
      persistDeFiPositions(targetAddress, sortedPositions);
      setError(null);

      const movementNativeStaking = PROTOCOL_REGISTRY.MOVEMENT || {
        name: "Movement Native Staking",
        website: "https://explorer.movementnetwork.xyz",
      };

      void discoverNativeStakingPositions({
        client,
        targetAddress,
        protocolInfo: movementNativeStaking,
      }).then((nativePositions) => {
        if (!nativePositions.length) {
          return;
        }

        if (currentFetchGeneration !== fetchGeneration.current || lastFetchedAddress.current !== targetAddress) {
          return;
        }

        setPositions((previousPositions) => {
          const withoutNativeStaking = previousPositions.filter(
            (position) => !(position.protocolName === movementNativeStaking.name && position.source === "view")
          );
          const mergedPositions = sortDetectedPositions([...withoutNativeStaking, ...nativePositions]);
          persistDeFiPositions(targetAddress, mergedPositions);
          return mergedPositions;
        });
      }).catch((nativeStakingError) => {
        devLog("  ⚠️ Native staking scan error:", nativeStakingError?.message || nativeStakingError);
      });

    } catch (err) {
      console.error("❌ DeFi scan error:", err);
      
      let errorMsg = "Failed to scan DeFi positions";
      if (err.message?.includes("not found") || err.message?.includes("404")) {
        errorMsg = "Account not found or has no resources";
      } else if (err.message?.includes("network") || err.message?.includes("fetch")) {
        errorMsg = "Network error. Please try again.";
      }
      
      setError(errorMsg);
      setPositions([]);
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  }, [targetAddress, client, clientError]);

  // Auto-fetch when address changes
  useEffect(() => {
    if (targetAddress && targetAddress !== lastFetchedAddress.current) {
      fetchPositions();
    } else if (targetAddress && !client) {
      setLoading(clientLoading);
    } else if (!targetAddress) {
      setPositions([]);
      setLoading(false);
      lastFetchedAddress.current = null;
    }
  }, [fetchPositions, targetAddress, client, clientLoading]);

  // Expose a refetch that always forces a fresh scan
  const forceRefetch = useCallback(() => {
    lastFetchedAddress.current = null; // Clear cache so fetchPositions runs
    return fetchPositions({ force: true });
  }, [fetchPositions]);

  return {
    positions,
    loading: loading || clientLoading,
    error,
    refetch: forceRefetch,
    targetAddress,
  };
};

export default useDeFiPositions;