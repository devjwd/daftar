import { createClient } from "@supabase/supabase-js";
import { devLog } from "../utils/devLogger";

import { resolveEntityBranding, syncEntities, findEntityByAddress, findEntityByName } from "./entityStore";
import { findTrackedDappMatch } from "../config/dapps";
import { DEFAULT_NETWORK } from "../config/network";
import { getTokenInfo, getTokenAddressBySymbol } from "../config/tokens";
import { parseCoinType, getTokenDecimals, isValidAddress } from "../utils/tokenUtils";
import { markTransaction, TX_TYPES } from "./historyEngine";

const REQUEST_TIMEOUT_MS = 10_000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const TRANSACTION_HISTORY_LIMIT = 100;
const DEFAULT_LIMIT = TRANSACTION_HISTORY_LIMIT;
const MAX_LIMIT = 10000;
const ACTIVITY_FETCH_MULTIPLIER = 12;
const MAX_ACTIVITY_ROWS = 1200;
const PRUNE_BATCH_SIZE = 250;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const COINGECKO_TOKEN_IDS = {
  MOVE: "movement",
  GMOVE: "movement",
  gMOVE: "movement",
  USDC: "usd-coin",
  USDT: "tether",
  WETH: "ethereum",
  WBTC: "wrapped-bitcoin",
};

const ADDRESS_PATTERN = /0x[a-f0-9]{1,128}/ig;

let supabaseClient = null;
const pricePromiseCache = new Map();

let entityCachePromise: Promise<any[]> | null = null;
let entityCacheExpiry = 0;
const ENTITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const resolveEnv = () => {
  const env = (typeof import.meta !== "undefined" && (import.meta as any).env) ? (import.meta as any).env : {};

  return {
    rpcUrl: String(
      env.VITE_MOVEMENT_RPC_URL ||
      DEFAULT_NETWORK.rpc ||
      ""
    ).trim() || null,
    indexerUrl: String(
      env.VITE_MOVEMENT_INDEXER_URL ||
      DEFAULT_NETWORK.indexer ||
      ""
    ).trim() || null,
    supabaseUrl: String(
      env.VITE_SUPABASE_URL ||
      ""
    ).trim() || null,
    supabaseAnonKey: String(
      env.VITE_SUPABASE_ANON_KEY ||
      ""
    ).trim() || null,
    // NOTE: Service role key intentionally excluded from frontend — server-only secret
  };
};

const getSupabaseClient = () => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { supabaseUrl, supabaseAnonKey } = resolveEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return supabaseClient;
  } catch (error) {
    console.error("Failed to initialize Supabase client:", error);
    return null;
  }
};

import {
  toNumber,
  getTimestampMs,
  toIsoDate,
  toSqlDate,
  toCoinGeckoDate,
  includesAny,
  extractAddressCandidates,
  detectTransactionDapp,
  classifyTransactionType,
  getTokenMeta,
  rawAmountToDisplay,
  normalizeActivity,
  extractNormalizedActivities,
  getFunctionName,
  calculateGasFeeInMove,
  isGasActivity,
  getPrimaryActivity,
  isDistinctAssetPair,
  getCounterpartyAddress,
  buildStructuredTransaction,
  normalizePrimaryTransactionRow,
  normalizeUserTransactionRow,
  normalizeActivityRows,
  groupActivitiesByVersion,
  mergeTransactionsWithActivities
} from './transformers/transactionNormalizer';
import { normalizeAddress } from '../utils/address';

const normalizeLimit = (limit) => {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
};

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const parseTimestampDate = (value) => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value}Z`
      : value;
    return new Date(normalized);
  }

  return new Date(value);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getTrackedEntities = async () => {
  if (entityCachePromise && Date.now() < entityCacheExpiry) {
    return entityCachePromise;
  }

  const supabase = getSupabaseClient();
  if (!supabase) return [];

  entityCachePromise = (async () => {
    try {
      const { data } = await supabase
        .from('tracked_entities')
        .select('*')
        .is('is_verified', true);

      return Array.isArray(data) ? data : [];
    } catch (error) {
      devLog('Failed to fetch tracked entities:', error);
      return [];
    }
  })();

  entityCacheExpiry = Date.now() + ENTITY_CACHE_TTL;
  return entityCachePromise;
};

const postGraphQL = async (query, variables = {}) => {
  const { indexerUrl } = resolveEnv();
  if (!indexerUrl) {
    devLog("Transaction service indexer request failed: missing indexer URL");
    return { data: null, error: "Missing indexer URL" };
  }

  try {
    const response = await fetchWithTimeout(indexerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const message = `Indexer request failed (${response.status} ${response.statusText})`;
      devLog(message);
      return { data: null, error: message };
    }

    const json = await parseJsonSafe(response);
    if (!json) {
      devLog("Transaction service indexer request failed: invalid JSON response");
      return { data: null, error: "Invalid JSON response" };
    }

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const message = String(json.errors[0]?.message || "Unknown GraphQL error");
      devLog("Transaction service GraphQL error:", message);
      return { data: null, error: message };
    }

    return { data: json.data || null, error: null };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `Indexer request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : String(error?.message || error);
    devLog("Transaction service indexer request failed:", message);
    return { data: null, error: message };
  }
};

// Normalization logic extracted to transactionNormalizer
const fetchRecentActivityRows = async (address, transactionLimit) => {
  const limit = Math.max(
    transactionLimit,
    Math.min(MAX_ACTIVITY_ROWS, transactionLimit * ACTIVITY_FETCH_MULTIPLIER)
  );

  const query = `
    query WalletActivities($address: String!, $limit: Int!) {
      fungible_asset_activities(
        where: { owner_address: { _eq: $address } }
        order_by: { transaction_timestamp: desc }
        limit: $limit
      ) {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        asset_type
        type
        is_transaction_success
        entry_function_id_str
        metadata {
          symbol
          decimals
        }
      }
    }
  `;

  const { data, error } = await postGraphQL(query, { address, limit });
  if (error) {
    return [];
  }

  return Array.isArray(data?.fungible_asset_activities)
    ? data.fungible_asset_activities
    : [];
};

const fetchPrimaryTransactions = async (address, limit) => {
  const query = `
    query WalletTransactions($address: String!, $limit: Int!) {
      account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: desc }
        limit: $limit
      ) {
        transaction_version
        user_transaction {
          sender
          timestamp
          entry_function_id_str
        }
        fungible_asset_activities {
          transaction_version
          transaction_timestamp
          owner_address
          amount
          asset_type
          type
          is_transaction_success
          entry_function_id_str
          metadata {
            symbol
            decimals
          }
        }
      }
    }
  `;

  const { data, error } = await postGraphQL(query, { address, limit });
  if (error) {
    return [];
  }

  return Array.isArray(data?.account_transactions)
    ? data.account_transactions.map(normalizePrimaryTransactionRow).filter((row) => row.tx_hash)
    : [];
};

const fetchUserTransactionsFallback = async (address, limit) => {
  const query = `
    query WalletUserTransactions($address: String!, $limit: Int!) {
      user_transactions(
        where: { sender: { _eq: $address } }
        order_by: { version: desc }
        limit: $limit
      ) {
        version
        sender
        timestamp
        entry_function_id_str
      }
    }
  `;

  const { data, error } = await postGraphQL(query, { address, limit });
  if (error) {
    return [];
  }

  return Array.isArray(data?.user_transactions)
    ? data.user_transactions.map(normalizeUserTransactionRow).filter((row) => row.tx_hash)
    : [];
};

const fetchActivityFallback = async (address, limit) => {
  const activityRows = await fetchRecentActivityRows(address, limit);

  return activityRows.length > 0
    ? normalizeActivityRows(activityRows)
    : [];
};

const uniqueTransactions = (rows = []) => {
  const seen = new Set();
  const output = [];

  for (const row of rows) {
    const key = String(row?.tx_hash || row?.transaction_version || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }

  return output;
};

const sortTransactionsByTimestampDesc = (rows = []) => {
  return [...rows].sort((left, right) => getTimestampMs(right?.tx_timestamp || right?.timestamp) - getTimestampMs(left?.tx_timestamp || left?.timestamp));
};

const trimTransactions = (rows = [], limit = DEFAULT_LIMIT) => {
  return sortTransactionsByTimestampDesc(rows).slice(0, normalizeLimit(limit));
};

const TYPE_FILTER_GROUPS = {
  lending: new Set(["lend", "borrow", "repay"]),
  staking: new Set(["stake", "unstake", "claim"]),
  transfers: new Set(["transfer", "received"]),
  defi: new Set(["deposit", "withdraw", "lend", "borrow", "repay"]),
};

export const filterTransactionsByType = (rows = [], type = "all") => {
  const normalizedType = String(type || "all").trim().toLowerCase();
  const normalizedRows = Array.isArray(rows) ? rows : [];

  if (normalizedType === "all") {
    return normalizedRows;
  }

  const group = TYPE_FILTER_GROUPS[normalizedType];
  if (group) {
    return normalizedRows.filter((row) => group.has(String(row?.tx_type || "other").toLowerCase()));
  }

  return normalizedRows.filter((row) => String(row?.tx_type || "other").toLowerCase() === normalizedType);
};

const pruneStoredTransactions = async (supabase, walletAddress, keepLimit = DEFAULT_LIMIT) => {
  if (!supabase || !walletAddress) {
    return;
  }

  const normalizedKeepLimit = normalizeLimit(keepLimit);

  while (true) {
    const { data, error } = await supabase
      .from("transaction_history")
      .select("tx_hash")
      .eq("wallet_address", walletAddress)
      .order("tx_timestamp", { ascending: false })
      .range(normalizedKeepLimit, normalizedKeepLimit + PRUNE_BATCH_SIZE - 1);

    if (error) {
      devLog("Failed to read transaction history for pruning:", error);
      return;
    }

    const hashesToDelete = Array.isArray(data)
      ? data.map((row) => row?.tx_hash).filter(Boolean)
      : [];

    if (hashesToDelete.length === 0) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("transaction_history")
      .delete()
      .eq("wallet_address", walletAddress)
      .in("tx_hash", hashesToDelete);

    if (deleteError) {
      devLog("Failed to prune transaction history:", deleteError);
      return;
    }
  }
};

const fetchCoinGeckoHistoricalPrice = async (tokenSymbol, date) => {
  const geckoId = COINGECKO_TOKEN_IDS[String(tokenSymbol || "").toUpperCase()];
  const formattedDate = toCoinGeckoDate(date);

  if (!geckoId || !formattedDate) {
    return 0;
  }

  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(geckoId)}/history?date=${formattedDate}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      devLog("Failed to fetch CoinGecko price:", response.status, response.statusText);
      return 0;
    }

    const json = await parseJsonSafe(response);
    return toNumber(json?.market_data?.current_price?.usd);
  } catch (error) {
    devLog("Failed to fetch CoinGecko price:", error);
    return 0;
  }
};

const enrichTransactionsWithUsd = async (walletAddress, transactions) => {
  const normalizedAddress = normalizeAddress(walletAddress);

  // Batch: collect all unique (token, date) pairs first
  const priceLookups = new Map();
  for (const tx of transactions) {
    const priceDate = tx?.tx_timestamp || tx?.timestamp || new Date().toISOString();
    const sqlDate = toSqlDate(priceDate);
    if (tx?.token_in) {
      const key = `${String(tx.token_in).trim().toUpperCase()}|${sqlDate}`;
      if (!priceLookups.has(key)) {
        priceLookups.set(key, getTokenPrice(tx.token_in, priceDate));
      }
    }
    if (tx?.token_out) {
      const key = `${String(tx.token_out).trim().toUpperCase()}|${sqlDate}`;
      if (!priceLookups.has(key)) {
        priceLookups.set(key, getTokenPrice(tx.token_out, priceDate));
      }
    }
  }

  // Resolve all prices in parallel
  const priceKeys = Array.from(priceLookups.keys());
  const priceValues = await Promise.all(Array.from(priceLookups.values()));
  const priceMap = new Map();
  priceKeys.forEach((key, i) => priceMap.set(key, priceValues[i] || 0));

  const now = new Date().toISOString();
  return transactions.map((tx) => {
    const priceDate = tx?.tx_timestamp || tx?.timestamp || now;
    const sqlDate = toSqlDate(priceDate);
    const inKey = tx?.token_in ? `${String(tx.token_in).trim().toUpperCase()}|${sqlDate}` : null;
    const outKey = tx?.token_out ? `${String(tx.token_out).trim().toUpperCase()}|${sqlDate}` : null;
    const amountInUsd = inKey ? toNumber(tx.amount_in) * (priceMap.get(inKey) || 0) : 0;
    const amountOutUsd = outKey ? toNumber(tx.amount_out) * (priceMap.get(outKey) || 0) : 0;
    const pnlUsd = tx.tx_type === "swap" ? amountOutUsd - amountInUsd : 0;

    return {
      wallet_address: normalizedAddress,
      tx_hash: tx.tx_hash,
      tx_type: tx.tx_type,
      dapp_key: tx.dapp_key,
      dapp_name: tx.dapp_name,
      dapp_logo: tx.dapp_logo,
      dapp_website: tx.dapp_website,
      dapp_contract: tx.dapp_contract,
      token_in: tx.token_in,
      token_out: tx.token_out,
      amount_in: tx.amount_in,
      amount_out: tx.amount_out,
      amount_in_usd: amountInUsd,
      amount_out_usd: amountOutUsd,
      pnl_usd: pnlUsd,
      gas_fee: tx.gas_fee,
      status: tx.status || "success",
      tx_timestamp: tx.tx_timestamp,
      fetched_at: now,
    };
  });
};

const DAFTAR_BRANDING = {
  dapp_key: 'daftar',
  dapp_name: 'DAFTAR swap',
  dapp_logo: '/daftar%20icon.png',
  dapp_website: 'https://daftar.fi',
};

const applyProjectBranding = (rows) => {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    // 1. (DISABLED) Priority: Explicit Daftar Branding
    // The user requested to disable this for now to avoid confusion on aggregators like Mosaic
    /*
    if (
      row.source === 'daftar_swap' || 
      row.dapp_name === 'Daftar' || 
      row.dapp_name === 'DAFTAR swap'
    ) {
      return { ...row, ...DAFTAR_BRANDING, tx_type: row.tx_type || 'swap', is_verified: true };
    }
    */

    // 2. Tracked Entities Branding (Supabase Verified)
    const contractAddr = row.dapp_contract || row.to_address;
    let entity = findEntityByAddress(contractAddr);

    if (!entity && row.dapp_name && (row.dapp_name === 'Daftar' || row.dapp_name === 'DAFTAR swap')) {
      entity = findEntityByName(row.dapp_name);
    }

    if (entity) {
      const badgeLabel = entity.custom_type || entity.category || row.tx_type || 'other';
      const normalizedLabel = String(badgeLabel).toLowerCase().trim();
      const finalLabel = (normalizedLabel === 'other' && entity.name) ? 'protocol' : normalizedLabel;

      return {
        ...row,
        dapp_name: entity.name || row.dapp_name,
        dapp_logo: entity.logo_url || row.dapp_logo,
        dapp_website: entity.website_url || row.dapp_website,
        badge_color: entity.badge_color,
        tx_type: finalLabel,
        is_verified: true
      };
    }

    // 3. Cleanup: Only fallback to Wallet if there is NO dapp match from the history engine 
    // AND it's a simple transfer.
    if (!entity && !row.dapp_key) {
      const isSimpleTransfer = !row.dapp_contract || ['transfer', 'send', 'received'].includes(row.tx_type);

      if (isSimpleTransfer) {
        return {
          ...row,
          dapp_name: 'Wallet',
          dapp_logo: null,
          tx_type: row.tx_type || 'transfer'
        };
      }
    }

    return row;
  });
};

const toPersistedTransactionRow = (row) => ({
  wallet_address: row.wallet_address,
  tx_hash: row.tx_hash,
  tx_type: row.tx_type,
  dapp_key: row.dapp_key || null,
  dapp_name: row.dapp_name || null,
  dapp_logo: row.dapp_logo || null,
  dapp_website: row.dapp_website || null,
  dapp_contract: row.dapp_contract || null,
  token_in: row.token_in,
  token_out: row.token_out,
  amount_in: row.amount_in,
  amount_out: row.amount_out,
  amount_in_usd: row.amount_in_usd,
  amount_out_usd: row.amount_out_usd,
  pnl_usd: row.pnl_usd,
  gas_fee: row.gas_fee,
  status: row.status,
  tx_timestamp: row.tx_timestamp,
  fetched_at: row.fetched_at,
  source: row.source || 'indexer',
});

export const fetchTransactions = async (walletAddress, limit = DEFAULT_LIMIT) => {
  const normalizedAddress = normalizeAddress(walletAddress);
  if (!isValidAddress(normalizedAddress)) {
    devLog("fetchTransactions failed: invalid wallet address", walletAddress);
    return [];
  }

  const normalizedLimit = normalizeLimit(limit);

  try {
    const primaryRows = await fetchPrimaryTransactions(normalizedAddress, normalizedLimit);
    if (primaryRows.length > 0) {
      return trimTransactions(uniqueTransactions(primaryRows), normalizedLimit);
    }

    const fallbackRows = await fetchUserTransactionsFallback(normalizedAddress, normalizedLimit);
    if (fallbackRows.length > 0) {
      const activityRows = await fetchRecentActivityRows(normalizedAddress, normalizedLimit);
      return trimTransactions(uniqueTransactions(mergeTransactionsWithActivities(fallbackRows, activityRows)), normalizedLimit);
    }

    const activityRows = await fetchActivityFallback(normalizedAddress, normalizedLimit);
    return trimTransactions(uniqueTransactions(activityRows), normalizedLimit);
  } catch (error) {
    devLog("fetchTransactions failed:", error);
    return [];
  }
};

export const parseTransaction = async (rawTx, walletAddress = "") => {
  try {
    if (!rawTx || typeof rawTx !== "object") {
      return {
        tx_hash: "",
        tx_type: "other",
        token_in: null,
        token_out: null,
        amount_in: null,
        amount_out: null,
        gas_fee: 0,
        tx_timestamp: null,
        status: "failed",
        counterparty_address: null,
      };
    }

    const activities = extractNormalizedActivities(rawTx);
    return await buildStructuredTransaction(rawTx, activities, walletAddress);
  } catch (error) {
    devLog("parseTransaction failed:", error);
    return {
      tx_hash: String(rawTx?.tx_hash || rawTx?.hash || ""),
      tx_type: "other",
      token_in: null,
      token_out: null,
      amount_in: null,
      amount_out: null,
      gas_fee: 0,
      tx_timestamp: rawTx?.tx_timestamp || rawTx?.timestamp || null,
      status: rawTx?.success === false ? "failed" : "success",
      counterparty_address: null,
    };
  }
};

export const getTokenPrice = async (token, date) => {
  const normalizedToken = String(token || "").trim().toUpperCase();
  const sqlDate = toSqlDate(date);
  const cacheKey = `${normalizedToken}|${sqlDate || "unknown"}`;

  if (!normalizedToken || !sqlDate) {
    return 0;
  }

  if (!COINGECKO_TOKEN_IDS[normalizedToken]) {
    return 0;
  }

  if (pricePromiseCache.has(cacheKey)) {
    return pricePromiseCache.get(cacheKey);
  }

  const pricePromise = (async () => {
    const supabase = getSupabaseClient();
    const tokenAddress = getTokenAddressBySymbol(normalizedToken);
    const normAddress = tokenAddress ? tokenAddress.toLowerCase().replace(/^0x0*/, '0x') : null;

    if (supabase && normAddress) {
      try {
        const { data, error } = await supabase
          .from("token_price_history")
          .select("price")
          .eq("token_address", normAddress)
          .gte("timestamp", `${sqlDate}T00:00:00Z`)
          .lte("timestamp", `${sqlDate}T23:59:59Z`)
          .limit(1)
          .maybeSingle();

        if (error) {
          devLog("Failed to read price history:", error);
        } else if (data?.price !== undefined && data?.price !== null) {
          return toNumber(data.price);
        }
      } catch (error) {
        devLog("Failed to query price history:", error);
      }
    }

    const remotePrice = await fetchCoinGeckoHistoricalPrice(normalizedToken, sqlDate);

    if (remotePrice > 0 && supabase && normAddress) {
      try {
        const { error } = await supabase.from("token_price_history").upsert(
          {
            token_address: normAddress,
            price: remotePrice,
            timestamp: `${sqlDate}T12:00:00Z`,
            granularity: 'daily',
          },
          { onConflict: "token_address,timestamp" }
        );

        if (error) {
          devLog("Failed to cache token price in history:", error);
        }
      } catch (error) {
        devLog("Failed to upsert token price history cache:", error);
      }
    }

    return remotePrice;
  })();

  pricePromiseCache.set(cacheKey, pricePromise);
  return pricePromise;
};

export const calculatePNL = (transactions) => {
  try {
    const rows = Array.isArray(transactions) ? transactions : [];
    const now = Date.now();
    const start90d = now - NINETY_DAYS_MS;
    const start7d = now - (7 * 24 * 60 * 60 * 1000);
    const start30d = now - (30 * 24 * 60 * 60 * 1000);
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    let totalPnl = 0;
    let todayPnl = 0;
    let weekPnl = 0;
    let monthPnl = 0;
    let bestTrade = 0;
    let worstTrade = 0;
    let totalVolume = 0;
    let hasTrade = false;
    const byDayMap = new Map();

    for (const tx of rows) {
      if (String(tx?.tx_type || "").toLowerCase() !== "swap") {
        continue;
      }

      const txTime = getTimestampMs(tx?.tx_timestamp || tx?.timestamp || 0);
      const amountInUsd = toNumber(tx?.amount_in_usd);
      const amountOutUsd = toNumber(tx?.amount_out_usd);
      const pnl = Number.isFinite(Number(tx?.pnl_usd)) ? Number(tx.pnl_usd) : amountOutUsd - amountInUsd;
      const volume = Math.max(amountInUsd, amountOutUsd);

      totalPnl += pnl;
      totalVolume += volume;
      if (!hasTrade) {
        bestTrade = pnl;
        worstTrade = pnl;
        hasTrade = true;
      } else {
        if (pnl > bestTrade) bestTrade = pnl;
        if (pnl < worstTrade) worstTrade = pnl;
      }

      if (txTime >= startToday.getTime()) {
        todayPnl += pnl;
      }
      if (txTime >= start7d) {
        weekPnl += pnl;
      }
      if (txTime >= start30d) {
        monthPnl += pnl;
      }
      if (txTime >= start90d) {
        const dateKey = toSqlDate(tx?.tx_timestamp || tx?.timestamp);
        if (dateKey) {
          byDayMap.set(dateKey, toNumber(byDayMap.get(dateKey)) + pnl);
        }
      }
    }

    const byDay = Array.from(byDayMap.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, pnl]) => ({ date, pnl }));

    return {
      totalPnl,
      todayPnl,
      weekPnl,
      monthPnl,
      byDay,
      bestTrade: hasTrade ? bestTrade : 0,
      worstTrade: hasTrade ? worstTrade : 0,
      totalVolume,
    };
  } catch (error) {
    devLog("calculatePNL failed:", error);
    return {
      totalPnl: 0,
      todayPnl: 0,
      weekPnl: 0,
      monthPnl: 0,
      byDay: [],
      bestTrade: 0,
      worstTrade: 0,
      totalVolume: 0,
    };
  }
};

const KNOWN_EXCHANGES = ['Binance', 'OKX', 'Coinbase', 'MEXC', 'Gate', 'Bitget', 'KuCoin', 'Bybit', 'Kraken'];

const getExchangeDepositInfo = (labelObj) => {
  if (!labelObj) return null;

  const entityName = labelObj.entity?.name;
  const isExchangeEntity = labelObj.entity?.category === 'Exchange' || (entityName && KNOWN_EXCHANGES.some(ex => entityName.toLowerCase() === ex.toLowerCase()));
  const isDepositLabel = labelObj.label_name && (
    labelObj.label_name.toLowerCase().includes('deposit') ||
    labelObj.label_name.toLowerCase().includes('exchange')
  );

  if (isExchangeEntity || isDepositLabel) {
    let exchangeName = entityName || 'Exchange';
    if (exchangeName === 'Exchange' && labelObj.label_name) {
      for (const ex of KNOWN_EXCHANGES) {
        if (labelObj.label_name.toLowerCase().includes(ex.toLowerCase())) {
          exchangeName = ex;
          break;
        }
      }
    }
    return {
      exchangeName,
      label: `${exchangeName} Deposit`
    };
  }

  return null;
};

export const getOrFetchTransactions = async (walletAddress, options: any = {}) => {
  const normalizedAddress = normalizeAddress(walletAddress);
  if (!isValidAddress(normalizedAddress)) {
    devLog("getOrFetchTransactions failed: invalid wallet address", walletAddress);
    return [];
  }

  const limit = normalizeLimit(options.limit ?? DEFAULT_LIMIT);
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

  try {
    // 1. Fetch directly from Indexer for real-time history (Saves Hobby Plan resources)
    const rawTransactions = await fetchTransactions(normalizedAddress, limit);
    if (rawTransactions.length === 0) return [];

    // Pre-fetch entities once for the entire batch (avoids 100 redundant cache checks)
    await getTrackedEntities();

    const parsedTransactions = (await Promise.all(
      rawTransactions.map(async (row) => await parseTransaction(row, normalizedAddress))
    )).filter((row) => row.tx_hash);

    const counterparties = new Set();
    for (const tx of parsedTransactions) {
      if (tx.counterparty_address) {
        counterparties.add(tx.counterparty_address);
      }
    }

    const labelsMap = new Map();
    if (counterparties.size > 0) {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data } = await supabase
          .from('address_labels')
          .select('*, tracked_entities(name, category)')
          .in('address', Array.from(counterparties));

        if (data) {
          for (const row of data) {
            labelsMap.set(normalizeAddress(row.address), {
              label_name: row.label_name,
              entity: row.tracked_entities
            });
          }
        }
      }
    }

    const enrichedTransactions = trimTransactions(
      await enrichTransactionsWithUsd(normalizedAddress, parsedTransactions),
      limit
    );

    const processedTransactions = enrichedTransactions.map(tx => {
      if (tx.counterparty_address && labelsMap.has(tx.counterparty_address)) {
        const depositInfo = getExchangeDepositInfo(labelsMap.get(tx.counterparty_address));
        if (depositInfo && (tx.tx_type === 'send' || tx.tx_type === 'transfer')) {
          return {
            ...tx,
            tx_type: 'send', // Keep as 'send' so it remains in Transfers filter
            tx_label: depositInfo.label,
            dapp_name: depositInfo.exchangeName,
          };
        }
      }
      return tx;
    });

    // 2. Return branding-applied results (No sync to DB)
    return trimTransactions(applyProjectBranding(processedTransactions), limit);
  } catch (error) {
    console.error("getOrFetchTransactions failed:", error);
    return [];
  }
};

export const getTransactionByHash = async (txHash: string) => {
  let cleanInput = String(txHash || "").trim();
  const isVersion = /^\d+$/.test(cleanInput);

  if (!isVersion && cleanInput && !cleanInput.startsWith("0x")) {
    cleanInput = "0x" + cleanInput;
  }

  const queryFields = `
        version
        hash
        sender
        timestamp
        gas_used
        gas_unit_price
        entry_function_id_str
        payload
        fungible_asset_activities {
          transaction_version
          transaction_timestamp
          owner_address
          amount
          asset_type
          type
          is_transaction_success
          entry_function_id_str
          metadata {
            symbol
            decimals
          }
        }
        events {
          type
          data
          account_address
          sequence_number
        }
  `;

  const query = isVersion ? `
    query GetTransactionByVersion($version: bigint!) {
      user_transactions(where: {version: {_eq: $version}}, limit: 1) {
        ${queryFields}
      }
    }
  ` : `
    query GetTransactionByHash($hash: String!) {
      user_transactions(where: {hash: {_eq: $hash}}, limit: 1) {
        ${queryFields}
      }
    }
  `;

  let rawTx = null;
  try {
    const variables = isVersion ? { version: cleanInput } : { hash: cleanInput };
    const { data, error } = await postGraphQL(query, variables);
    if (!error && data?.user_transactions?.length > 0) {
      rawTx = data.user_transactions[0];
    }
  } catch (err) {
    devLog("getTransactionByHash indexer lookup failed:", err);
  }

  if (!rawTx) {
    const { rpcUrl } = resolveEnv();
    if (rpcUrl) {
      try {
        const endpoint = isVersion ? `/transactions/by_version/${cleanInput}` : `/transactions/by_hash/${cleanInput}`;
        const response = await fetchWithTimeout(`${rpcUrl}${endpoint}`);
        if (response.ok) {
          const nodeTx = await response.json();
          if (nodeTx) {
            rawTx = {
              hash: nodeTx.hash,
              sender: nodeTx.sender,
              timestamp: nodeTx.timestamp,
              gas_used: nodeTx.gas_used,
              gas_unit_price: nodeTx.gas_unit_price,
              success: nodeTx.success,
              entry_function_id_str: nodeTx.payload?.function || null,
              payload: nodeTx.payload || null,
              version: nodeTx.version,
              fungible_asset_activities: [],
              events: nodeTx.events || []
            };
          }
        }
      } catch (err) {
        devLog("getTransactionByHash Node RPC lookup failed:", err);
      }
    }
  }

  if (!rawTx) {
    return null;
  }

  const normalized = normalizeUserTransactionRow(rawTx);
  const parsed = await parseTransaction(normalized, normalized.sender || "");

  // Apply project branding to show logo and dApp name
  const branded = applyProjectBranding([parsed])[0] || parsed;
  branded.wallet_address = normalized.sender;
  branded.sender = normalized.sender;
  branded.version = normalized.transaction_version;
  return branded;
};

export default {
  fetchTransactions,
  parseTransaction,
  getTokenPrice,
  getOrFetchTransactions,
  getTransactionByHash,
};

