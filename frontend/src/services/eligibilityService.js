import { getRecentTransactions, getWalletAge } from "./indexer";
import { getTokenInfo } from "../config/tokens";

const DEFAULT_FETCH_LIMIT = 2000;

const STABLE_TOKEN_ADDRESSES = new Set([
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d", // USDT
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39", // USDC
  "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650", // USDa
  "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c", // USDe
]);

const normalizeAddress = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
};

const extractAssetAddress = (assetType) => {
  const normalized = normalizeAddress(assetType);
  if (!normalized) return "";
  return normalized.includes("::") ? normalized.split("::")[0] : normalized;
};

const parseTimestampMs = (value) => {
  if (!value) return 0;

  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

const toUtcDayKey = (timestampMs) => {
  if (!timestampMs) return "";
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseRawAmount = (value) => {
  try {
    if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
    if (!value) return 0;
    return Number(value);
  } catch (_e) {
    return 0;
  }
};

const getTokenDecimalsForAsset = (assetType) => {
  const assetAddress = extractAssetAddress(assetType);
  const tokenInfo = getTokenInfo(assetAddress) || getTokenInfo(assetType);
  return tokenInfo?.decimals || 8;
};

const getTokenPriceUsd = (assetType, priceMap = {}) => {
  const assetAddress = extractAssetAddress(assetType);
  const fullType = String(assetType || "").toLowerCase();

  if (priceMap[fullType] !== undefined) return Number(priceMap[fullType]) || 0;
  if (priceMap[assetAddress] !== undefined) return Number(priceMap[assetAddress]) || 0;
  if (assetAddress === "0x1" && priceMap["0xa"] !== undefined) return Number(priceMap["0xa"]) || 0;
  if (assetAddress === "0xa" && priceMap["0x1"] !== undefined) return Number(priceMap["0x1"]) || 0;

  if (STABLE_TOKEN_ADDRESSES.has(assetAddress)) return 1;
  return 0;
};

const isLikelyOutgoing = (activityType) => /withdraw|debit|send|sent|out/i.test(String(activityType || ""));
const isLikelyIncoming = (activityType) => /deposit|credit|receive|received|in/i.test(String(activityType || ""));

const buildTradeGroups = (activities = []) => {
  const grouped = new Map();

  for (const activity of activities) {
    const version = activity?.transaction_version;
    const timestampMs = parseTimestampMs(activity?.transaction_timestamp);
    const owner = normalizeAddress(activity?.owner_address);
    const fallbackKey = `${owner}:${timestampMs}`;
    const groupKey = version !== undefined && version !== null ? String(version) : fallbackKey;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(activity);
  }

  return grouped;
};

const summarizeTradeGroups = (groupedActivities, priceMap = {}) => {
  const summaries = [];

  groupedActivities.forEach((activities, groupKey) => {
    if (!Array.isArray(activities) || activities.length < 2) return;

    const tokenAddresses = new Set();
    let outgoingUsd = 0;
    let incomingUsd = 0;
    let grossUsd = 0;
    let timestampMs = 0;

    for (const activity of activities) {
      const assetType = activity?.asset_type || "";
      const assetAddress = extractAssetAddress(assetType);
      if (assetAddress) tokenAddresses.add(assetAddress);

      const amountRaw = parseRawAmount(activity?.amount);
      const decimals = getTokenDecimalsForAsset(assetType);
      const normalizedAmount = amountRaw / Math.pow(10, decimals);
      const usdPrice = getTokenPriceUsd(assetType, priceMap);
      const usdValue = normalizedAmount * usdPrice;

      if (isLikelyOutgoing(activity?.type)) {
        outgoingUsd += usdValue;
      } else if (isLikelyIncoming(activity?.type)) {
        incomingUsd += usdValue;
      }

      grossUsd += usdValue;
      timestampMs = Math.max(timestampMs, parseTimestampMs(activity?.transaction_timestamp));
    }

    if (tokenAddresses.size < 2) return;

    const tradeVolumeUsd = outgoingUsd > 0
      ? outgoingUsd
      : incomingUsd > 0
        ? incomingUsd
        : grossUsd / 2;

    summaries.push({
      tradeId: groupKey,
      timestampMs,
      dayKey: toUtcDayKey(timestampMs),
      tokenAddresses: Array.from(tokenAddresses),
      volumeUsd: tradeVolumeUsd,
    });
  });

  return summaries;
};

/**
 * Get trading metrics for badge eligibility.
 * Uses grouped swap-like fungible activities as an off-chain approximation.
 */
export const getTradingMetrics = async (address, options = {}) => {
  const {
    limit = DEFAULT_FETCH_LIMIT,
    priceMap = {},
  } = options;

  try {
    const activities = await getRecentTransactions(address, limit);
    const grouped = buildTradeGroups(Array.isArray(activities) ? activities : []);
    const trades = summarizeTradeGroups(grouped, priceMap);

    const activeDaySet = new Set();
    const tokenSet = new Set();
    let totalVolumeUsd = 0;

    for (const trade of trades) {
      if (trade.dayKey) activeDaySet.add(trade.dayKey);
      totalVolumeUsd += trade.volumeUsd || 0;
      trade.tokenAddresses.forEach((addressValue) => tokenSet.add(addressValue));
    }

    return {
      tradesCount: trades.length,
      activeTradingDays: activeDaySet.size,
      uniqueTokensTraded: tokenSet.size,
      totalVolumeUsd,
      evaluatedActivities: activities.length,
      evaluatedTrades: trades,
    };
  } catch (error) {
    console.error("Failed to get trading metrics:", error);
    return {
      tradesCount: 0,
      activeTradingDays: 0,
      uniqueTokensTraded: 0,
      totalVolumeUsd: 0,
      evaluatedActivities: 0,
      evaluatedTrades: [],
      error: error.message,
    };
  }
};

/**
 * Get transaction count for an address
 */
export const getTransactionCount = async (address) => {
  try {
    const metrics = await getTradingMetrics(address, { limit: 1000 });
    return metrics.tradesCount;
  } catch (error) {
    console.error("Failed to get transaction count:", error);
    return 0;
  }
};

/**
 * Get first transaction timestamp
 */
export const getFirstTransactionDate = async (address) => {
  try {
    const walletAge = await getWalletAge(address);
    if (walletAge?.firstTxTimestamp) return walletAge.firstTxTimestamp;

    const txns = await getRecentTransactions(address, 1000);
    if (!Array.isArray(txns) || txns.length === 0) return null;

    let oldestMs = Number.MAX_SAFE_INTEGER;
    for (const txn of txns) {
      const currentMs = parseTimestampMs(txn?.transaction_timestamp);
      if (currentMs > 0 && currentMs < oldestMs) oldestMs = currentMs;
    }

    return oldestMs === Number.MAX_SAFE_INTEGER ? null : oldestMs;
  } catch (error) {
    console.error("Failed to get first transaction date:", error);
    return null;
  }
};

/**
 * Get days since first transaction
 */
export const getDaysOnchain = async (address) => {
  try {
    const firstTxTime = await getFirstTransactionDate(address);
    if (!firstTxTime) return 0;

    const now = Date.now();
    const firstTxMs = parseTimestampMs(firstTxTime);
    const daysDiff = Math.floor((now - firstTxMs) / (1000 * 60 * 60 * 24));

    return Math.max(0, daysDiff);
  } catch (error) {
    console.error("Failed to get days onchain:", error);
    return 0;
  }
};

/**
 * Check if address qualifies for activity badge
 * @param address Wallet address
 * @param requiredCount Required transaction count
 */
export const checkActivityEligibility = async (address, requiredCount) => {
  const txCount = await getTransactionCount(address);
  return {
    eligible: txCount >= requiredCount,
    current: txCount,
    required: requiredCount,
  };
};

/**
 * Check if address qualifies for longevity badge
 * @param address Wallet address
 * @param requiredDays Required days onchain
 */
export const checkLongevityEligibility = async (address, requiredDays) => {
  const daysOnchain = await getDaysOnchain(address);
  return {
    eligible: daysOnchain >= requiredDays,
    current: daysOnchain,
    required: requiredDays,
    firstTxDate: await getFirstTransactionDate(address),
  };
};

/**
 * Get all eligible activity badges for address
 */
export const getEligibleActivityBadges = async (address, tiers) => {
  const txCount = await getTransactionCount(address);
  return tiers.filter((tier) => txCount >= tier.count);
};

/**
 * Get all eligible longevity badges for address
 */
export const getEligibleLongevityBadges = async (address, tiers) => {
  const daysOnchain = await getDaysOnchain(address);
  return tiers.filter((tier) => daysOnchain >= tier.days);
};

/**
 * Check if address qualifies for trade count badge.
 */
export const checkTradeCountEligibility = async (address, requiredTrades, options = {}) => {
  const metrics = await getTradingMetrics(address, options);
  return {
    eligible: metrics.tradesCount >= requiredTrades,
    current: metrics.tradesCount,
    required: requiredTrades,
    metrics,
  };
};

/**
 * Check if address qualifies for active trading days badge.
 */
export const checkActiveTradingDaysEligibility = async (address, requiredDays, options = {}) => {
  const metrics = await getTradingMetrics(address, options);
  return {
    eligible: metrics.activeTradingDays >= requiredDays,
    current: metrics.activeTradingDays,
    required: requiredDays,
    metrics,
  };
};

/**
 * Check if address qualifies for trading volume badge.
 */
export const checkTradingVolumeEligibility = async (address, requiredVolumeUsd, options = {}) => {
  const metrics = await getTradingMetrics(address, options);
  return {
    eligible: metrics.totalVolumeUsd >= requiredVolumeUsd,
    current: metrics.totalVolumeUsd,
    required: requiredVolumeUsd,
    metrics,
  };
};

/**
 * Check if address qualifies for unique token diversity badge.
 */
export const checkTokenDiversityEligibility = async (address, requiredTokenCount, options = {}) => {
  const metrics = await getTradingMetrics(address, options);
  return {
    eligible: metrics.uniqueTokensTraded >= requiredTokenCount,
    current: metrics.uniqueTokensTraded,
    required: requiredTokenCount,
    metrics,
  };
};

/**
 * Get comprehensive eligibility report
 */
export const getEligibilityReport = async (address, options = {}) => {
  try {
    const txCount = await getTransactionCount(address);
    const daysOnchain = await getDaysOnchain(address);
    const firstTxDate = await getFirstTransactionDate(address);
    const tradingMetrics = await getTradingMetrics(address, options);

    return {
      address,
      transactionCount: txCount,
      daysOnchain,
      tradesCount: tradingMetrics.tradesCount,
      activeTradingDays: tradingMetrics.activeTradingDays,
      uniqueTokensTraded: tradingMetrics.uniqueTokensTraded,
      totalVolumeUsd: tradingMetrics.totalVolumeUsd,
      firstTransactionDate: firstTxDate
        ? new Date(parseTimestampMs(firstTxDate))
        : null,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error("Failed to get eligibility report:", error);
    return {
      address,
      transactionCount: 0,
      daysOnchain: 0,
      tradesCount: 0,
      activeTradingDays: 0,
      uniqueTokensTraded: 0,
      totalVolumeUsd: 0,
      firstTransactionDate: null,
      fetchedAt: new Date(),
      error: error.message,
    };
  }
};
