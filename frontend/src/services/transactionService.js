import { createClient } from "@supabase/supabase-js";

import { DEFAULT_NETWORK } from "../config/network.js";
import { getTokenInfo } from "../config/tokens.js";
import { parseCoinType, getTokenDecimals, isValidAddress } from "../utils/tokenUtils.js";

const REQUEST_TIMEOUT_MS = 10_000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const TRANSACTION_HISTORY_LIMIT = 100;
const DEFAULT_LIMIT = TRANSACTION_HISTORY_LIMIT;
const MAX_LIMIT = TRANSACTION_HISTORY_LIMIT;
const PRUNE_BATCH_SIZE = 250;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const COINGECKO_TOKEN_IDS = {
  MOVE: "movement-2",
  GMOVE: "movement-2",
  gMOVE: "movement-2",
  USDC: "usd-coin",
  USDT: "tether",
  WETH: "ethereum",
  WBTC: "wrapped-bitcoin",
};

let supabaseClient = null;
const pricePromiseCache = new Map();

const resolveEnv = () => {
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
  const processEnv = (typeof globalThis !== "undefined" && globalThis.process?.env) ? globalThis.process.env : {};

  return {
    rpcUrl: String(
      env.VITE_MOVEMENT_RPC_URL ||
      processEnv.VITE_MOVEMENT_RPC_URL ||
      processEnv.MOVEMENT_RPC_URL ||
      DEFAULT_NETWORK.rpc ||
      ""
    ).trim() || null,
    indexerUrl: String(
      env.VITE_MOVEMENT_INDEXER_URL ||
      processEnv.VITE_MOVEMENT_INDEXER_URL ||
      processEnv.MOVEMENT_INDEXER_URL ||
      DEFAULT_NETWORK.indexer ||
      ""
    ).trim() || null,
    supabaseUrl: String(
      env.VITE_SUPABASE_URL ||
      processEnv.VITE_SUPABASE_URL ||
      processEnv.SUPABASE_URL ||
      ""
    ).trim() || null,
    supabaseAnonKey: String(
      env.VITE_SUPABASE_ANON_KEY ||
      processEnv.VITE_SUPABASE_ANON_KEY ||
      processEnv.SUPABASE_ANON_KEY ||
      ""
    ).trim() || null,
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

const normalizeAddress = (walletAddress) => {
  const raw = String(walletAddress || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
};

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

const postGraphQL = async (query, variables = {}) => {
  const { indexerUrl } = resolveEnv();
  if (!indexerUrl) {
    console.error("Transaction service indexer request failed: missing indexer URL");
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
      console.error(message);
      return { data: null, error: message };
    }

    const json = await parseJsonSafe(response);
    if (!json) {
      console.error("Transaction service indexer request failed: invalid JSON response");
      return { data: null, error: "Invalid JSON response" };
    }

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const message = String(json.errors[0]?.message || "Unknown GraphQL error");
      console.error("Transaction service GraphQL error:", message);
      return { data: null, error: message };
    }

    return { data: json.data || null, error: null };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `Indexer request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : String(error?.message || error);
    console.error("Transaction service indexer request failed:", message);
    return { data: null, error: message };
  }
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const getTimestampMs = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const toIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const toSqlDate = (value) => {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
};

const toCoinGeckoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
};

const classifyTransactionType = (functionName = "") => {
  const lower = String(functionName || "").toLowerCase();
  if (lower.includes("swap") || lower.includes("collect_fee")) return "swap";
  if (lower.includes("deposit")) return "deposit";
  if (lower.includes("withdraw")) return "withdraw";
  if (lower.includes("transfer")) return "transfer";
  return "other";
};

const getTokenMeta = (assetType) => {
  const value = String(assetType || "").trim();
  if (!value) {
    return { symbol: null, decimals: 8 };
  }

  const parsedCoin = parseCoinType(`0x1::coin::CoinStore<${value}>`);
  const tokenInfo = getTokenInfo(value) || parsedCoin?.tokenInfo || null;
  const symbol = tokenInfo?.symbol || parsedCoin?.symbol || value.split("::").pop() || null;
  const decimals = tokenInfo?.decimals || getTokenDecimals(`0x1::coin::CoinStore<${value}>`, parsedCoin);

  return { symbol: symbol ? String(symbol).toUpperCase() : null, decimals };
};

const rawAmountToDisplay = (rawAmount, decimals = 8) => {
  const amountNum = Number(rawAmount);
  if (!Number.isFinite(amountNum)) {
    return 0;
  }

  return amountNum / Math.pow(10, Math.max(0, Number(decimals) || 0));
};

const normalizeActivity = (activity) => {
  if (!activity) return null;

  const type = String(activity.type || activity.event_type || "").toLowerCase();
  const assetType = String(activity.asset_type || activity.coin_type || activity.coinType || "").trim();
  const { symbol, decimals } = getTokenMeta(assetType);
  const amount = rawAmountToDisplay(
    activity.amount ?? activity.data?.amount ?? activity.data?.value,
    decimals
  );

  if (!assetType && !symbol && amount === 0) {
    return null;
  }

  let direction = null;
  if (type.includes("withdraw")) direction = "out";
  if (type.includes("deposit")) direction = "in";
  if (!direction && type.includes("transfer")) {
    direction = String(activity.from_address || activity.sender || "").toLowerCase() === String(activity.owner_address || "").toLowerCase()
      ? "out"
      : "in";
  }

  return {
    direction,
    type,
    assetType,
    symbol,
    amount,
  };
};

const extractNormalizedActivities = (rawTx) => {
  const normalized = [];

  const fungibleActivities = Array.isArray(rawTx?.fungibleActivities)
    ? rawTx.fungibleActivities
    : Array.isArray(rawTx?.fungible_asset_activities)
      ? rawTx.fungible_asset_activities
      : [];

  for (const activity of fungibleActivities) {
    const nextActivity = normalizeActivity(activity);
    if (nextActivity) {
      normalized.push(nextActivity);
    }
  }

  const events = Array.isArray(rawTx?.events) ? rawTx.events : [];
  for (const event of events) {
    const nextActivity = normalizeActivity({
      type: event?.type,
      amount: event?.data?.amount,
      asset_type: event?.data?.coin_type || event?.data?.asset_type,
      owner_address: event?.account_address,
      data: event?.data,
    });
    if (nextActivity) {
      normalized.push(nextActivity);
    }
  }

  return normalized;
};

const getFunctionName = (rawTx) => {
  return String(
    rawTx?.functionName ||
    rawTx?.entry_function_id_str ||
    rawTx?.entryFunctionId ||
    rawTx?.entryFunction ||
    rawTx?.payload?.function ||
    ""
  );
};

const calculateGasFeeInMove = (gasUsed, gasUnitPrice) => {
  const units = toNumber(gasUsed);
  const price = toNumber(gasUnitPrice);

  if (units <= 0 && price <= 0) {
    return 0;
  }

  if (units > 0 && price > 0) {
    return (units * price) / Math.pow(10, 8);
  }

  return units / Math.pow(10, 8);
};

const buildStructuredTransaction = (rawTx, activities) => {
  const functionName = getFunctionName(rawTx);
  const txType = classifyTransactionType(functionName);
  const incoming = activities.filter((activity) => activity.direction === "in" && activity.amount > 0);
  const outgoing = activities.filter((activity) => activity.direction === "out" && activity.amount > 0);

  let tokenIn = null;
  let tokenOut = null;
  let amountIn = null;
  let amountOut = null;

  if (txType === "swap") {
    tokenIn = outgoing[0]?.symbol || null;
    tokenOut = incoming[0]?.symbol || null;
    amountIn = outgoing[0]?.amount ?? null;
    amountOut = incoming[0]?.amount ?? null;
  } else if (txType === "deposit") {
    tokenOut = incoming[0]?.symbol || null;
    amountOut = incoming[0]?.amount ?? null;
    tokenIn = outgoing[0]?.symbol || null;
    amountIn = outgoing[0]?.amount ?? null;
  } else if (txType === "withdraw") {
    tokenIn = outgoing[0]?.symbol || null;
    amountIn = outgoing[0]?.amount ?? null;
    tokenOut = incoming[0]?.symbol || null;
    amountOut = incoming[0]?.amount ?? null;
  } else if (txType === "transfer") {
    tokenIn = outgoing[0]?.symbol || null;
    tokenOut = incoming[0]?.symbol || null;
    amountIn = outgoing[0]?.amount ?? null;
    amountOut = incoming[0]?.amount ?? null;
  } else {
    tokenIn = outgoing[0]?.symbol || null;
    tokenOut = incoming[0]?.symbol || null;
    amountIn = outgoing[0]?.amount ?? null;
    amountOut = incoming[0]?.amount ?? null;
  }

  return {
    tx_hash: String(rawTx?.tx_hash || rawTx?.hash || rawTx?.transaction_version || ""),
    tx_type: txType,
    token_in: tokenIn,
    token_out: tokenOut,
    amount_in: amountIn,
    amount_out: amountOut,
    gas_fee: calculateGasFeeInMove(rawTx?.gas_used, rawTx?.gas_unit_price),
    tx_timestamp: rawTx?.tx_timestamp || rawTx?.timestamp || rawTx?.transaction_timestamp || null,
    status: rawTx?.success === false || rawTx?.status === "failed" ? "failed" : "success",
  };
};

const normalizePrimaryTransactionRow = (row) => {
  const userTransaction = row?.user_transaction || row?.userTransaction || row;

  return {
    tx_hash: userTransaction?.hash || String(row?.transaction_version || userTransaction?.version || ""),
    sender: userTransaction?.sender || null,
    timestamp: userTransaction?.timestamp || row?.transaction_timestamp || null,
    tx_timestamp: userTransaction?.timestamp || row?.transaction_timestamp || null,
    gas_used: userTransaction?.gas_used ?? null,
    gas_unit_price: userTransaction?.gas_unit_price ?? null,
    success: userTransaction?.success ?? true,
    functionName:
      userTransaction?.entry_function_id_str ||
      userTransaction?.entry_function_function_name ||
      userTransaction?.payload?.function ||
      null,
    payload: userTransaction?.payload || null,
    transaction_version: row?.transaction_version || userTransaction?.version || null,
    fungibleActivities: Array.isArray(row?.fungible_asset_activities) ? row.fungible_asset_activities : [],
    events: Array.isArray(row?.events)
      ? row.events
      : Array.isArray(userTransaction?.events)
        ? userTransaction.events
        : [],
  };
};

const normalizeUserTransactionRow = (row) => ({
  tx_hash: row?.hash || String(row?.version || ""),
  sender: row?.sender || null,
  timestamp: row?.timestamp || null,
  tx_timestamp: row?.timestamp || null,
  gas_used: row?.gas_used ?? null,
  gas_unit_price: row?.gas_unit_price ?? null,
  success: row?.success ?? true,
  functionName: row?.entry_function_id_str || row?.payload?.function || null,
  payload: row?.payload || null,
  transaction_version: row?.version || null,
  fungibleActivities: Array.isArray(row?.fungible_asset_activities) ? row.fungible_asset_activities : [],
  events: Array.isArray(row?.events) ? row.events : [],
});

const normalizeActivityRows = (rows = []) => {
  const grouped = new Map();

  for (const row of rows) {
    const version = String(row?.transaction_version || row?.version || row?.tx_hash || "");
    if (!version) continue;

    if (!grouped.has(version)) {
      grouped.set(version, {
        tx_hash: String(row?.transaction_version || row?.version || ""),
        sender: row?.owner_address || null,
        timestamp: row?.transaction_timestamp || null,
        tx_timestamp: row?.transaction_timestamp || null,
        gas_used: null,
        gas_unit_price: null,
        success: row?.is_transaction_success ?? true,
        functionName: null,
        transaction_version: row?.transaction_version || row?.version || null,
        fungibleActivities: [],
        events: [],
      });
    }

    grouped.get(version).fungibleActivities.push(row);
  }

  return Array.from(grouped.values());
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
        transaction_timestamp
        fungible_asset_activities {
          amount
          asset_type
          type
          owner_address
          is_transaction_success
        }
        user_transaction {
          version
          hash
          sender
          timestamp
          success
          gas_used
          gas_unit_price
          entry_function_id_str
          entry_function_function_name
          payload
          events {
            type
            data
            account_address
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
        hash
        sender
        timestamp
        success
        gas_used
        gas_unit_price
        entry_function_id_str
        entry_function_function_name
        payload
        events {
          type
          data
          account_address
        }
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
      }
    }
  `;

  const { data, error } = await postGraphQL(query, { address, limit });
  if (error) {
    return [];
  }

  return Array.isArray(data?.fungible_asset_activities)
    ? normalizeActivityRows(data.fungible_asset_activities)
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

export const filterTransactionsByType = (rows = [], type = "all") => {
  const normalizedType = String(type || "all").trim().toLowerCase();
  const normalizedRows = Array.isArray(rows) ? rows : [];

  if (normalizedType === "all") {
    return normalizedRows;
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
      console.error("Failed to read transaction history for pruning:", error);
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
      console.error("Failed to prune transaction history:", deleteError);
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
      console.error("Failed to fetch CoinGecko price:", response.status, response.statusText);
      return 0;
    }

    const json = await parseJsonSafe(response);
    return toNumber(json?.market_data?.current_price?.usd);
  } catch (error) {
    console.error("Failed to fetch CoinGecko price:", error);
    return 0;
  }
};

const enrichTransactionsWithUsd = async (walletAddress, transactions) => {
  const normalizedAddress = normalizeAddress(walletAddress);
  const enriched = [];

  for (const tx of transactions) {
    try {
      const priceDate = tx?.tx_timestamp || tx?.timestamp || new Date().toISOString();
      const amountInUsd = tx?.token_in ? (toNumber(tx.amount_in) * await getTokenPrice(tx.token_in, priceDate)) : 0;
      const amountOutUsd = tx?.token_out ? (toNumber(tx.amount_out) * await getTokenPrice(tx.token_out, priceDate)) : 0;
      const pnlUsd = tx.tx_type === "swap" ? amountOutUsd - amountInUsd : 0;

      enriched.push({
        wallet_address: normalizedAddress,
        tx_hash: tx.tx_hash,
        tx_type: tx.tx_type,
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
        fetched_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to enrich transaction with USD values:", error);
      enriched.push({
        wallet_address: normalizedAddress,
        tx_hash: tx.tx_hash,
        tx_type: tx.tx_type,
        token_in: tx.token_in,
        token_out: tx.token_out,
        amount_in: tx.amount_in,
        amount_out: tx.amount_out,
        amount_in_usd: 0,
        amount_out_usd: 0,
        pnl_usd: 0,
        gas_fee: tx.gas_fee,
        status: tx.status || "success",
        tx_timestamp: tx.tx_timestamp,
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return enriched;
};

export const fetchTransactions = async (walletAddress, limit = DEFAULT_LIMIT) => {
  const normalizedAddress = normalizeAddress(walletAddress);
  if (!isValidAddress(normalizedAddress)) {
    console.error("fetchTransactions failed: invalid wallet address", walletAddress);
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
      return trimTransactions(uniqueTransactions(fallbackRows), normalizedLimit);
    }

    const activityRows = await fetchActivityFallback(normalizedAddress, normalizedLimit);
    return trimTransactions(uniqueTransactions(activityRows), normalizedLimit);
  } catch (error) {
    console.error("fetchTransactions failed:", error);
    return [];
  }
};

export const parseTransaction = (rawTx) => {
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
      };
    }

    const activities = extractNormalizedActivities(rawTx);
    return buildStructuredTransaction(rawTx, activities);
  } catch (error) {
    console.error("parseTransaction failed:", error);
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

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("price_cache")
          .select("price_usd")
          .eq("token", normalizedToken)
          .eq("date", sqlDate)
          .maybeSingle();

        if (error) {
          console.error("Failed to read price cache:", error);
        } else if (data?.price_usd !== undefined && data?.price_usd !== null) {
          return toNumber(data.price_usd);
        }
      } catch (error) {
        console.error("Failed to query price cache:", error);
      }
    }

    const remotePrice = await fetchCoinGeckoHistoricalPrice(normalizedToken, sqlDate);

    if (remotePrice > 0 && supabase) {
      try {
        const { error } = await supabase.from("price_cache").upsert(
          {
            token: normalizedToken,
            date: sqlDate,
            price_usd: remotePrice,
            cached_at: new Date().toISOString(),
          },
          { onConflict: "token,date" }
        );

        if (error) {
          console.error("Failed to cache token price:", error);
        }
      } catch (error) {
        console.error("Failed to upsert token price cache:", error);
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

      const txTime = new Date(tx?.tx_timestamp || tx?.timestamp || 0).getTime();
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
    console.error("calculatePNL failed:", error);
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

export const getOrFetchTransactions = async (walletAddress, options = {}) => {
  const normalizedAddress = normalizeAddress(walletAddress);
  if (!isValidAddress(normalizedAddress)) {
    console.error("getOrFetchTransactions failed: invalid wallet address", walletAddress);
    return [];
  }

  const persist = options.persist !== false;
  const allowCachedRead = options.allowCachedRead !== false;
  const limit = normalizeLimit(options.limit ?? DEFAULT_LIMIT);
  const supabase = persist || allowCachedRead ? getSupabaseClient() : null;

  try {
    if (supabase && allowCachedRead) {
      const { data: cachedRows, error: cacheError } = await supabase
        .from("transaction_history")
        .select("*")
        .eq("wallet_address", normalizedAddress)
        .order("tx_timestamp", { ascending: false })
        .limit(limit);

      if (cacheError) {
        console.error("Failed to read transaction cache:", cacheError);
      } else if (Array.isArray(cachedRows) && cachedRows.length > 0) {
        if (cachedRows.length > limit) {
          await pruneStoredTransactions(supabase, normalizedAddress, limit);
        }

        const freshestFetch = cachedRows.reduce((latest, row) => {
          const nextTime = new Date(row?.fetched_at || 0).getTime();
          return nextTime > latest ? nextTime : latest;
        }, 0);

        if (freshestFetch > 0 && (Date.now() - freshestFetch) < CACHE_TTL_MS) {
          return trimTransactions(cachedRows, limit);
        }
      }
    }

    const rawTransactions = await fetchTransactions(normalizedAddress, limit);
    const parsedTransactions = rawTransactions
      .map((row) => parseTransaction(row))
      .filter((row) => row.tx_hash);

    const enrichedTransactions = trimTransactions(
      await enrichTransactionsWithUsd(normalizedAddress, parsedTransactions),
      limit
    );

    if (persist && supabase && enrichedTransactions.length > 0) {
      try {
        const { error } = await supabase
          .from("transaction_history")
          .upsert(enrichedTransactions, { onConflict: "tx_hash" });

        if (error) {
          console.error("Failed to upsert transaction history:", error);
        }

        await pruneStoredTransactions(supabase, normalizedAddress, limit);
      } catch (error) {
        console.error("Failed to save transaction history:", error);
      }

      try {
        const { data: refreshedRows, error: refreshedError } = await supabase
          .from("transaction_history")
          .select("*")
          .eq("wallet_address", normalizedAddress)
          .order("tx_timestamp", { ascending: false })
          .limit(limit);

        if (refreshedError) {
          console.error("Failed to read refreshed transaction history:", refreshedError);
        } else if (Array.isArray(refreshedRows)) {
          return trimTransactions(refreshedRows, limit);
        }
      } catch (error) {
        console.error("Failed to fetch refreshed transaction history:", error);
      }
    }

    return trimTransactions(enrichedTransactions, limit);
  } catch (error) {
    console.error("getOrFetchTransactions failed:", error);
    return [];
  }
};

export default {
  fetchTransactions,
  parseTransaction,
  getTokenPrice,
  calculatePNL,
  getOrFetchTransactions,
};