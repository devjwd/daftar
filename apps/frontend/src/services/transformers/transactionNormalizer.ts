import { findTrackedDappMatch } from "../../config/dapps";
import { getTokenInfo } from "../../config/tokens";
import { parseCoinType, getTokenDecimals, isValidAddress } from "../../utils/tokenUtils";
import { markTransaction, TX_TYPES } from "../historyEngine";
import { normalizeAddress } from "../../utils/address";
import { getTrackedEntities } from "../transactionService";
import { parseTimestampDate } from "../../utils/formatters";

const ADDRESS_PATTERN = /0x[a-f0-9]{1,128}/ig;
export const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getTimestampMs = (value) => {
  const timestamp = parseTimestampDate(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const toIsoDate = (value) => {
  const date = parseTimestampDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

export const toSqlDate = (value) => {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
};

export const toCoinGeckoDate = (value) => {
  const date = parseTimestampDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
};

export const includesAny = (value, needles = []) => needles.some((needle) => value.includes(needle));

export const extractAddressCandidates = (rawTx, activities = []) => {
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
    appendAddresses(activity?.owner);
  }

  return Array.from(candidates);
};

export const detectTransactionDapp = (rawTx, activities = []) => {
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

export const classifyTransactionType = (functionName = "", activities = [], dapp = null) => {
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

export const getTokenMeta = (assetType) => {
  const value = String(assetType || "").trim();
  if (!value) {
    return { symbol: null, decimals: 8 };
  }

  const parsedCoin = parseCoinType(`0x1::coin::CoinStore<${value}>`);
  const tokenInfo = getTokenInfo(value) || parsedCoin?.tokenInfo || null;
  const symbol = tokenInfo?.symbol || (parsedCoin?.symbol ? String(parsedCoin.symbol).toUpperCase() : null) || (value.split("::").pop() ? String(value.split("::").pop()).toUpperCase() : null);
  const decimals = tokenInfo?.decimals || getTokenDecimals(`0x1::coin::CoinStore<${value}>`, parsedCoin);

  return { symbol, decimals };
};

export const rawAmountToDisplay = (rawAmount, decimals = 8) => {
  const amountNum = Number(rawAmount);
  if (!Number.isFinite(amountNum)) {
    return 0;
  }

  return amountNum / Math.pow(10, Math.max(0, Number(decimals) || 0));
};

export const normalizeActivity = (activity) => {
  if (!activity) return null;

  const type = String(activity.type || activity.event_type || "").toLowerCase();
  const assetType = String(activity.asset_type || activity.coin_type || activity.coinType || "").trim();
  const indexerSymbol = activity.metadata?.symbol || null;
  const indexerDecimals = activity.metadata?.decimals ?? null;
  const { symbol: resolvedSymbol, decimals: resolvedDecimals } = getTokenMeta(assetType);
  const symbol = resolvedSymbol || indexerSymbol;
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

export const extractNormalizedActivities = (rawTx) => {
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

export const getFunctionName = (rawTx) => {
  return String(
    rawTx?.functionName ||
    rawTx?.entry_function_id_str ||
    rawTx?.entryFunctionId ||
    rawTx?.entryFunction ||
    rawTx?.payload?.function ||
    ""
  );
};

export const calculateGasFeeInMove = (gasUsed, gasUnitPrice) => {
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

export const isGasActivity = (activity) => String(activity?.type || "").toLowerCase().includes("gasfee");

export const getPrimaryActivity = (activities = []) => {
  const candidates = activities.filter((activity) => activity?.amount > 0 && !isGasActivity(activity));
  const source = candidates.length > 0 ? candidates : activities.filter((activity) => activity?.amount > 0);

  if (source.length === 0) {
    return null;
  }

  return [...source].sort((left, right) => toNumber(right?.amount) - toNumber(left?.amount))[0] || null;
};

export const isDistinctAssetPair = (leftActivity, rightActivity) => {
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

export const getCounterpartyAddress = (rawTx, activities, userAddress) => {
  const normalizedUser = normalizeAddress(userAddress);

  for (const act of activities) {
    const owner = normalizeAddress(act.owner);
    if (owner && owner !== normalizedUser && owner !== '0x1' && owner !== '0x3' && owner !== '0xa' && owner !== '0x0000000000000000000000000000000000000000000000000000000000000001') {
      return owner;
    }
  }

  const sender = normalizeAddress(rawTx?.sender || rawTx?.user_transaction?.sender);
  if (sender && sender !== normalizedUser) {
    return sender;
  }

  const toAddr = normalizeAddress(rawTx?.to_address || rawTx?.to || rawTx?.user_transaction?.to_address || rawTx?.user_transaction?.to);
  if (toAddr && toAddr !== normalizedUser) {
    return toAddr;
  }

  const functionArguments = Array.isArray(rawTx?.payload?.functionArguments)
    ? rawTx.payload.functionArguments
    : Array.isArray(rawTx?.payload?.arguments)
      ? rawTx.payload.arguments
      : [];

  for (const arg of functionArguments) {
    if (typeof arg === 'string' && arg.startsWith('0x')) {
      const normalizedArg = normalizeAddress(arg);
      if (normalizedArg && normalizedArg !== normalizedUser && normalizedArg !== '0x1' && normalizedArg !== '0x3' && normalizedArg !== '0xa' && normalizedArg !== '0x0000000000000000000000000000000000000000000000000000000000000001') {
        return normalizedArg;
      }
    }
  }

  return null;
};

export const buildStructuredTransaction = async (rawTx, activities, walletAddress = "") => {
  // Ensure dynamic entities are loaded before matching
  const entities = await getTrackedEntities();

  // Use the new History Engine for core marking logic
  const marked = markTransaction(rawTx, walletAddress, entities || []);

  // Apply additional branding and refinement
  const dapp = marked.dapp_key ? { key: marked.dapp_key, name: marked.dapp_name, logo: marked.dapp_logo, website: marked.dapp_website } : null;

  const senderAddress = normalizeAddress(rawTx?.sender || "");
  const userAddress = normalizeAddress(walletAddress) || senderAddress;

  return {
    tx_hash: String(marked.tx_hash),
    tx_type: marked.tx_type,
    tx_label: marked.tx_label,
    tx_icon: marked.tx_icon,
    tx_color: marked.tx_color,
    tx_bg: marked.tx_bg,
    dapp_key: dapp?.key || marked.dapp_key,
    dapp_name: dapp?.name || marked.dapp_name,
    dapp_logo: dapp?.logo || marked.dapp_logo,
    dapp_website: dapp?.website || marked.dapp_website,
    dapp_contract: marked.dapp_contract || null,
    token_in: marked.token_in,
    token_out: marked.token_out,
    amount_in: marked.amount_in,
    amount_out: marked.amount_out,
    gas_fee: calculateGasFeeInMove(rawTx?.gas_used, rawTx?.gas_unit_price),
    tx_timestamp: rawTx?.tx_timestamp || rawTx?.timestamp || rawTx?.transaction_timestamp || null,
    status: marked.status,
    counterparty_address: getCounterpartyAddress(rawTx, activities, walletAddress),
  };
};

export const normalizePrimaryTransactionRow = (row) => {
  const userTransaction = row?.user_transaction || row?.userTransaction || row;
  const fungibleActivities = Array.isArray(row?.fungible_asset_activities) ? row.fungible_asset_activities : [];
  
  let success = userTransaction?.success ?? row?.is_transaction_success;
  if (success === undefined && fungibleActivities.length > 0) {
    success = fungibleActivities.every(act => act.is_transaction_success !== false);
  }
  if (success === undefined) {
    success = true;
  }

  return {
    tx_hash: userTransaction?.hash || String(row?.transaction_version || userTransaction?.version || ""),
    sender: userTransaction?.sender || null,
    timestamp: userTransaction?.timestamp || row?.timestamp || row?.transaction_timestamp || null,
    tx_timestamp: userTransaction?.timestamp || row?.timestamp || row?.transaction_timestamp || null,
    gas_used: userTransaction?.gas_used ?? null,
    gas_unit_price: userTransaction?.gas_unit_price ?? null,
    success,
    functionName:
      userTransaction?.entry_function_id_str ||
      userTransaction?.entry_function_function_name ||
      userTransaction?.payload?.function ||
      null,
    payload: userTransaction?.payload || null,
    transaction_version: row?.transaction_version || userTransaction?.version || null,
    fungibleActivities,
    events: Array.isArray(row?.events)
      ? row.events
      : Array.isArray(userTransaction?.events)
        ? userTransaction.events
        : [],
  };
};

export const normalizeUserTransactionRow = (row) => ({
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

export const normalizeActivityRows = (rows = []) => {
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

export const groupActivitiesByVersion = (rows = []) => {
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

export const mergeTransactionsWithActivities = (transactions = [], activityRows = []) => {
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

