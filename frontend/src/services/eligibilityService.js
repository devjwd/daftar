import { getRecentTransactions, getWalletAge } from "./indexer";

/**
 * Get transaction count for an address
 */
export const getTransactionCount = async (address) => {
  try {
    const txns = await getRecentTransactions(address, 1000); // Fetch up to 1000 transactions
    return Array.isArray(txns) ? txns.length : 0;
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
    const txns = await getRecentTransactions(address, 1000);
    if (!Array.isArray(txns) || txns.length === 0) return null;

    // Find the oldest transaction (first one chronologically)
    let oldest = txns[0];
    for (const txn of txns) {
      const txnTime = txn.timestamp || txn.created_at || 0;
      const oldestTime = oldest.timestamp || oldest.created_at || 0;
      if (txnTime < oldestTime) {
        oldest = txn;
      }
    }

    return oldest.timestamp || oldest.created_at || null;
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
    const firstTxMs = firstTxTime * 1000 || firstTxTime; // Handle both seconds and ms
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
 * Get comprehensive eligibility report
 */
export const getEligibilityReport = async (address) => {
  try {
    const txCount = await getTransactionCount(address);
    const daysOnchain = await getDaysOnchain(address);
    const firstTxDate = await getFirstTransactionDate(address);

    return {
      address,
      transactionCount: txCount,
      daysOnchain,
      firstTransactionDate: firstTxDate
        ? new Date(firstTxDate * 1000 || firstTxDate)
        : null,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error("Failed to get eligibility report:", error);
    return {
      address,
      transactionCount: 0,
      daysOnchain: 0,
      firstTransactionDate: null,
      fetchedAt: new Date(),
      error: error.message,
    };
  }
};
