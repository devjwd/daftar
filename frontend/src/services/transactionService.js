import { createClient } from "@supabase/supabase-js";

import { findTrackedDappMatch } from "../config/dapps.js";
import { DEFAULT_NETWORK } from "../config/network.js";
import { getTokenInfo } from "../config/tokens.js";
import { parseCoinType, getTokenDecimals, isValidAddress } from "../utils/tokenUtils.js";

const REQUEST_TIMEOUT_MS = 10_000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const TRANSACTION_HISTORY_LIMIT = 100;
const DEFAULT_LIMIT = TRANSACTION_HISTORY_LIMIT;
const MAX_LIMIT = TRANSACTION_HISTORY_LIMIT;
const ACTIVITY_FETCH_MULTIPLIER = 12;
const MAX_ACTIVITY_ROWS = 1200;
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

const ADDRESS_PATTERN = /0x[a-f0-9]{1,128}/ig;

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
  const timestamp = parseTimestampDate(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const toIsoDate = (value) => {
  const date = parseTimestampDate(value);
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
  const date = parseTimestampDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
};

const includesAny = (value, needles = []) => needles.some((needle) => value.includes(needle));

const extractAddressCandidates = (rawTx, activities = []) => {
  const candidates = new Set();

  const appendAddresses = (value) => {
    const matches = String(value || "").match(ADDRESS_PATTERN) || [];
    for (const match of matches) {
      const normalized = normalizeAddress(match);
      if (normalized) {
        candidates.add(normalized);
      }
    }
  };

  appendAddresses(getFunctionName(rawTx));
  appendAddresses(rawTx?.payload?.function);

  const functionArguments = Array.isArray(rawTx?.payload?.functionArguments)
    ? rawTx.payload.functionArguments
    : Array.isArray(rawTx?.payload?.arguments)
      ? rawTx.payload.arguments
      : [];

  for (const argument of functionArguments) {
    appendAddresses(argument);
  }

  for (const activity of activities) {
    appendAddresses(activity?.assetType);
    appendAddresses(activity?.type);
  }

  return Array.from(candidates);
};

const detectTransactionDapp = (rawTx, activities = []) => {
  const functionName = getFunctionName(rawTx);
  return findTrackedDappMatch({
    textParts: [
      functionName,
      rawTx?.payload?.function,
      ...activities.flatMap((activity) => [activity?.type, activity?.assetType, activity?.symbol]),
    ],
    addresses: extractAddressCandidates(rawTx, activities),
  });
};

const classifyTransactionType = (functionName = "", activities = [], dapp = null) => {
  const lower = String(functionName || "").toLowerCase();
  const incoming = activities.filter((activity) => activity.direction === "in" && activity.amount > 0);
  const outgoing = activities.filter((activity) => activity.direction === "out" && activity.amount > 0);
  const lendingDapp = String(dapp?.protocolType || "").toLowerCase().includes("lending");

  if (includesAny(lower, ["swap", "collect_fee", "exact_input", "exact_output"])) return "swap";
  if (includesAny(lower, ["borrow", "flash_loan"])) return "borrow";
  if (includesAny(lower, ["repay"])) return "repay";
  if (includesAny(lower, ["lend", "supply"])) return "lend";
  if (includesAny(lower, ["stake", "delegate", "add_stake", "reactivate_stake"]) && !includesAny(lower, ["unstake", "unlock", "withdraw_stake", "request_withdraw"])) return "stake";
  if (includesAny(lower, ["unstake", "unlock", "undelegate", "withdraw_stake", "request_withdraw", "withdraw_pending"])) return "unstake";
  if (includesAny(lower, ["claim", "harvest", "collect_reward"])) return "claim";
  if (includesAny(lower, ["deposit", "add_liquidity", "join_pool", "mint_liquidity"])) {
    return lendingDapp ? "lend" : "deposit";
  }
  if (includesAny(lower, ["withdraw", "redeem", "remove_liquidity", "burn_liquidity"])) {
    return dapp?.key === "movement" ? "unstake" : "withdraw";
  }
  if (includesAny(lower, ["transfer", "coin::transfer"])) {
    if (incoming.length > 0 && outgoing.length === 0) return "received";
    return "transfer";
  }
  if (incoming.length > 0 && outgoing.length === 0) return "received";
  if (outgoing.length > 0 && incoming.length === 0) return "transfer";
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
  const indexerSymbol = activity.metadata?.symbol || null;
  const indexerDecimals = activity.metadata?.decimals ?? null;
  const { symbol: resolvedSymbol, decimals: resolvedDecimals } = getTokenMeta(assetType);
  const symbol = indexerSymbol || resolvedSymbol;
  const decimals = indexerDecimals ?? resolvedDecimals;
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
    owner: String(activity.owner_address || activity.ownerAddress || "").toLowerCase().trim(),
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

const isGasActivity = (activity) => String(activity?.type || "").toLowerCase().includes("gasfee");

const getPrimaryActivity = (activities = []) => {
  const candidates = activities.filter((activity) => activity?.amount > 0 && !isGasActivity(activity));
  const source = candidates.length > 0 ? candidates : activities.filter((activity) => activity?.amount > 0);

  if (source.length === 0) {
    return null;
  }

  return [...source].sort((left, right) => toNumber(right?.amount) - toNumber(left?.amount))[0] || null;
};

const isDistinctAssetPair = (leftActivity, rightActivity) => {
  if (!leftActivity || !rightActivity) {
    return false;
  }

  const leftSymbol = String(leftActivity.symbol || "").trim().toUpperCase();
  const rightSymbol = String(rightActivity.symbol || "").trim().toUpperCase();
  const leftAssetType = String(leftActivity.assetType || "").trim().toLowerCase();
  const rightAssetType = String(rightActivity.assetType || "").trim().toLowerCase();

  if (leftAssetType && rightAssetType && leftAssetType !== rightAssetType) {
    return true;
  }

  return Boolean(leftSymbol && rightSymbol && leftSymbol !== rightSymbol);
};

const buildStructuredTransaction = (rawTx, activities, walletAddress = "") => {
  const functionName = getFunctionName(rawTx);
  const dapp = detectTransactionDapp(rawTx, activities);
  const txType = classifyTransactionType(functionName, activities, dapp);
  let finalTxType = txType;
  const incoming = activities.filter((activity) => activity.direction === "in" && activity.amount > 0);
  const outgoing = activities.filter((activity) => activity.direction === "out" && activity.amount > 0);

  const senderAddress = normalizeAddress(rawTx?.sender || "");
  const userAddress = normalizeAddress(walletAddress) || senderAddress;

  const ownerMatches = (activity) =>
    !activity.owner || !userAddress || activity.owner === userAddress;

  const userIncoming = incoming.filter(ownerMatches);
  const userOutgoing = outgoing.filter(ownerMatches);

  const primaryIncoming = getPrimaryActivity(incoming);
  const primaryOutgoing = getPrimaryActivity(outgoing);
  const primaryUserIncoming = getPrimaryActivity(userIncoming);
  const primaryUserOutgoing = getPrimaryActivity(userOutgoing);

  let tokenIn = null;
  let tokenOut = null;
  let amountIn = null;
  let amountOut = null;

  if (txType === "swap") {
    const swapOut = primaryUserOutgoing || primaryOutgoing;
    const swapInCandidates = (userIncoming.length > 0 ? userIncoming : incoming)
      .filter((a) => !isGasActivity(a) && a.symbol !== swapOut?.symbol);
    const swapIn = getPrimaryActivity(swapInCandidates) || primaryUserIncoming || primaryIncoming;

    tokenIn = swapOut?.symbol || null;
    tokenOut = swapIn?.symbol || null;
    amountIn = swapOut?.amount ?? null;
    amountOut = swapIn?.amount ?? null;
  } else if (txType === "lend" || txType === "deposit" || txType === "repay") {
    const supplied = primaryUserOutgoing || primaryOutgoing;
    tokenIn = supplied?.symbol || null;
    amountIn = supplied?.amount ?? null;
  } else if (txType === "stake") {
    const supplied = primaryUserOutgoing || primaryOutgoing;
    const receivedCandidates = (userIncoming.length > 0 ? userIncoming : incoming)
      .filter((activity) => !isGasActivity(activity) && isDistinctAssetPair(supplied, activity));
    const received = getPrimaryActivity(receivedCandidates) || primaryUserIncoming || primaryIncoming;

    tokenIn = supplied?.symbol || null;
    amountIn = supplied?.amount ?? null;

    if (isDistinctAssetPair(supplied, received)) {
      tokenOut = received?.symbol || null;
      amountOut = received?.amount ?? null;
    }
  } else if (txType === "withdraw" || txType === "unstake" || txType === "claim" || txType === "borrow") {
    const received = primaryUserIncoming || primaryIncoming;
    tokenOut = received?.symbol || null;
    amountOut = received?.amount ?? null;
  } else if (txType === "received") {
    tokenOut = primaryIncoming?.symbol || null;
    amountOut = primaryIncoming?.amount ?? null;
  } else if (txType === "transfer") {
    const transferOut = primaryUserOutgoing || null;
    const transferIn = primaryUserIncoming || null;

    if (transferOut && !transferIn) {
      finalTxType = "withdraw";
      tokenIn = transferOut?.symbol || null;
      amountIn = transferOut?.amount ?? null;
    } else if (transferIn && !transferOut) {
      finalTxType = "received";
      tokenOut = transferIn?.symbol || null;
      amountOut = transferIn?.amount ?? null;
    } else {
      const fallbackOut = transferOut || primaryOutgoing;
      const fallbackIn = transferIn || primaryIncoming;

      if (
        fallbackOut &&
        fallbackIn &&
        fallbackOut.symbol &&
        fallbackOut.symbol === fallbackIn.symbol &&
        Math.abs(toNumber(fallbackOut.amount) - toNumber(fallbackIn.amount)) < 1e-12
      ) {
        if (senderAddress && userAddress && senderAddress === userAddress) {
          finalTxType = "withdraw";
          tokenIn = fallbackOut.symbol || null;
          amountIn = fallbackOut.amount ?? null;
        } else {
          finalTxType = "received";
          tokenOut = fallbackIn.symbol || null;
          amountOut = fallbackIn.amount ?? null;
        }
      } else {
        tokenIn = fallbackOut?.symbol || null;
        tokenOut = fallbackIn?.symbol || null;
        amountIn = fallbackOut?.amount ?? null;
        amountOut = fallbackIn?.amount ?? null;
      }
    }
  } else {
    tokenIn = primaryOutgoing?.symbol || null;
    tokenOut = primaryIncoming?.symbol || null;
    amountIn = primaryOutgoing?.amount ?? null;
    amountOut = primaryIncoming?.amount ?? null;
  }

  return {
    tx_hash: String(rawTx?.tx_hash || rawTx?.hash || rawTx?.transaction_version || ""),
    tx_type: finalTxType,
    dapp_key: dapp?.key || null,
    dapp_name: dapp?.name || null,
    dapp_logo: dapp?.logo || null,
    dapp_website: dapp?.website || null,
    dapp_contract: dapp?.contracts?.[0] || null,
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
    timestamp: userTransaction?.timestamp || row?.timestamp || row?.transaction_timestamp || null,
    tx_timestamp: userTransaction?.timestamp || row?.timestamp || row?.transaction_timestamp || null,
    gas_used: userTransaction?.gas_used ?? null,
    gas_unit_price: userTransaction?.gas_unit_price ?? null,
    success: userTransaction?.success ?? row?.is_transaction_success ?? true,
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
        functionName: row?.entry_function_id_str || null,
        transaction_version: row?.transaction_version || row?.version || null,
        fungibleActivities: [],
        events: [],
      });
    }

    grouped.get(version).fungibleActivities.push(row);
  }

  return Array.from(grouped.values());
};

const groupActivitiesByVersion = (rows = []) => {
  const grouped = new Map();

  for (const row of rows) {
    const version = String(row?.transaction_version || row?.version || "");
    if (!version) continue;

    if (!grouped.has(version)) {
      grouped.set(version, []);
    }

    grouped.get(version).push(row);
  }

  return grouped;
};

const mergeTransactionsWithActivities = (transactions = [], activityRows = []) => {
  const activitiesByVersion = groupActivitiesByVersion(activityRows);

  return transactions.map((transaction) => {
    const version = String(transaction?.transaction_version || transaction?.tx_hash || "");
    if (!version || !activitiesByVersion.has(version)) {
      return transaction;
    }

    const existingActivities = Array.isArray(transaction?.fungibleActivities)
      ? transaction.fungibleActivities
      : [];

    return {
      ...transaction,
      fungibleActivities: [...existingActivities, ...activitiesByVersion.get(version)],
    };
  });
};

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
        fetched_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to enrich transaction with USD values:", error);
      enriched.push({
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

const toPersistedTransactionRow = (row) => ({
  wallet_address: row.wallet_address,
  tx_hash: row.tx_hash,
  tx_type: row.tx_type,
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
});

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
      const activityRows = await fetchRecentActivityRows(normalizedAddress, normalizedLimit);
      return trimTransactions(uniqueTransactions(mergeTransactionsWithActivities(fallbackRows, activityRows)), normalizedLimit);
    }

    const activityRows = await fetchActivityFallback(normalizedAddress, normalizedLimit);
    return trimTransactions(uniqueTransactions(activityRows), normalizedLimit);
  } catch (error) {
    console.error("fetchTransactions failed:", error);
    return [];
  }
};

export const parseTransaction = (rawTx, walletAddress = "") => {
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
    return buildStructuredTransaction(rawTx, activities, walletAddress);
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
          .gt("cached_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
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
      .map((row) => parseTransaction(row, normalizedAddress))
      .filter((row) => row.tx_hash);

    const enrichedTransactions = trimTransactions(
      await enrichTransactionsWithUsd(normalizedAddress, parsedTransactions),
      limit
    );

    if (persist && supabase && enrichedTransactions.length > 0) {
      try {
        const { error } = await supabase
          .from("transaction_history")
          .upsert(enrichedTransactions.map(toPersistedTransactionRow), { onConflict: "tx_hash" });

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
  getOrFetchTransactions,
};