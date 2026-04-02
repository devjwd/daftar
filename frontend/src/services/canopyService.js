import { CANOPY_CONFIG } from "../config/network.js";

const CANOPY_CORE_ROUTER_ADDRESS = CANOPY_CONFIG.coreRouterAddress;
const CANOPY_CORE_VAULTS_ADDRESS = CANOPY_CONFIG.coreVaultsAddress;
const CANOPY_LIQUIDSWAP_VAULTS_ADDRESS = CANOPY_CONFIG.liquidswapVaultsAddress;
const CANOPY_REWARDS_ADDRESS = CANOPY_CONFIG.rewardsAddress;

const VIEW_FUNCTIONS = {
  getVaults: [
    `${CANOPY_CORE_VAULTS_ADDRESS}::vaults::get_vaults`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::core_vaults::get_vaults`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::vault::get_vaults`,
    `${CANOPY_LIQUIDSWAP_VAULTS_ADDRESS}::vaults::get_vaults`,
  ],
  getUserPositions: [
    `${CANOPY_CORE_VAULTS_ADDRESS}::vaults::get_user_positions`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::core_vaults::get_user_positions`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::vault::get_user_positions`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::position::get_user_positions`,
  ],
  getPendingRewards: [
    `${CANOPY_REWARDS_ADDRESS}::rewards::get_pending_rewards`,
    `${CANOPY_REWARDS_ADDRESS}::rewards::pending_rewards`,
    `${CANOPY_REWARDS_ADDRESS}::claim::get_pending_rewards`,
  ],
  getVaultApy: [
    `${CANOPY_CORE_VAULTS_ADDRESS}::vaults::get_vault_apy`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::core_vaults::get_vault_apy`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::vault::get_vault_apy`,
    `${CANOPY_CORE_VAULTS_ADDRESS}::vaults::get_apy`,
  ],
};

const ENTRY_FUNCTIONS = {
  deposit: [
    `${CANOPY_CORE_ROUTER_ADDRESS}::router::deposit`,
    `${CANOPY_CORE_ROUTER_ADDRESS}::core_router::deposit`,
    `${CANOPY_CORE_ROUTER_ADDRESS}::vault_router::deposit`,
  ],
  withdraw: [
    `${CANOPY_CORE_ROUTER_ADDRESS}::router::withdraw`,
    `${CANOPY_CORE_ROUTER_ADDRESS}::core_router::withdraw`,
    `${CANOPY_CORE_ROUTER_ADDRESS}::vault_router::withdraw`,
  ],
  claimRewards: [
    `${CANOPY_REWARDS_ADDRESS}::rewards::claim`,
    `${CANOPY_REWARDS_ADDRESS}::claim::claim_rewards`,
    `${CANOPY_REWARDS_ADDRESS}::rewards::claim_rewards`,
  ],
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeAddress = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value?.toString === "function") return value.toString().toLowerCase();
  return String(value).toLowerCase();
};

const decodeBytes = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (!value.startsWith("0x")) {
      return value;
    }

    const normalized = value.slice(2);
    if (!normalized.length || normalized.length % 2 !== 0) {
      return value;
    }

    let output = "";
    for (let index = 0; index < normalized.length; index += 2) {
      const code = parseInt(normalized.slice(index, index + 2), 16);
      if (Number.isNaN(code)) {
        return value;
      }
      output += String.fromCharCode(code);
    }
    return output.replace(/\0+$/g, "");
  }

  if (Array.isArray(value)) {
    return new TextDecoder().decode(new Uint8Array(value));
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  return String(value);
};

const toNumber = (value, fallback = 0) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const formatPercent = (value) => `${toNumber(value, 0).toFixed(2)}%`;

const unwrapViewResult = (result) => {
  if (!Array.isArray(result)) {
    return result;
  }

  if (result.length === 1) {
    return result[0];
  }

  return result;
};

const getValue = (source, keys, fallback = undefined) => {
  if (!source || typeof source !== "object") return fallback;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return fallback;
};

const tryViewFunctions = async (client, functions, functionArguments = [], typeArguments = []) => {
  if (!client?.view) {
    return null;
  }

  for (const fn of functions) {
    try {
      const result = await client.view({
        payload: {
          function: fn,
          typeArguments,
          functionArguments,
        },
      });

      return unwrapViewResult(result);
    } catch {
      // Try the next function variant.
    }
  }

  return null;
};

const extractTransactionHash = (result) => {
  if (!result) return null;
  if (typeof result === "string") return result;
  return result.hash || result.transactionHash || result.txnHash || null;
};

const trySubmitTransaction = async (
  signAndSubmitTransaction,
  sender,
  functions,
  functionArguments = [],
  typeArguments = []
) => {
  if (typeof signAndSubmitTransaction !== "function" || !sender) {
    return null;
  }

  for (const fn of functions) {
    try {
      const result = await signAndSubmitTransaction({
        sender,
        data: {
          function: fn,
          typeArguments,
          functionArguments,
        },
      });

      return extractTransactionHash(result);
    } catch {
      // Try the next function variant.
    }
  }

  return null;
};

const normalizeVault = (vault, index) => {
  if (Array.isArray(vault)) {
    const [id, name, asset, apy, tvl, strategy] = vault;
    return {
      id: toNumber(id, index),
      name: decodeBytes(name) || `Vault ${index + 1}`,
      asset: decodeBytes(asset) || "Unknown",
      apy: toNumber(apy, 0),
      tvl: toNumber(tvl, 0),
      strategy: decodeBytes(strategy) || "Core",
    };
  }

  return {
    id: toNumber(getValue(vault, ["id", "vault_id", "vaultId"]), index),
    name: decodeBytes(getValue(vault, ["name", "vault_name", "vaultName"])) || `Vault ${index + 1}`,
    asset: decodeBytes(getValue(vault, ["asset", "underlying_asset", "coin_type", "coinType"])) || "Unknown",
    apy: toNumber(getValue(vault, ["apy", "apr", "current_apy", "currentApy"]), 0),
    tvl: toNumber(getValue(vault, ["tvl", "total_value_locked", "totalValueLocked"]), 0),
    strategy: decodeBytes(getValue(vault, ["strategy", "strategy_name", "strategyName"])) || "Core",
  };
};

const normalizeUserPosition = (position, index) => {
  if (Array.isArray(position)) {
    const [vaultId, vaultName, deposited, currentValue, pendingRewards] = position;
    return {
      vaultId: toNumber(vaultId, index),
      vaultName: decodeBytes(vaultName) || `Vault ${index + 1}`,
      deposited: toNumber(deposited, 0),
      currentValue: toNumber(currentValue, toNumber(deposited, 0)),
      pendingRewards: toNumber(pendingRewards, 0),
    };
  }

  const deposited = toNumber(getValue(position, ["deposited", "deposit", "principal", "amount"]), 0);

  return {
    vaultId: toNumber(getValue(position, ["vault_id", "vaultId", "id"]), index),
    vaultName: decodeBytes(getValue(position, ["vault_name", "vaultName", "name"])) || `Vault ${index + 1}`,
    deposited,
    currentValue: toNumber(getValue(position, ["current_value", "currentValue", "value"]), deposited),
    pendingRewards: toNumber(getValue(position, ["pending_rewards", "pendingRewards", "rewards"]), 0),
  };
};

const normalizeRewardBreakdown = (entry) => {
  if (Array.isArray(entry)) {
    const [token, amount] = entry;
    return {
      token: decodeBytes(token) || "Unknown",
      amount: toNumber(amount, 0),
    };
  }

  return {
    token: decodeBytes(getValue(entry, ["token", "coin", "asset", "symbol"])) || "Unknown",
    amount: toNumber(getValue(entry, ["amount", "value", "pending"]), 0),
  };
};

/**
 * Fetches Canopy vaults with status metadata so callers can distinguish
 * contract failures from legitimate empty responses.
 *
 * @param {object} client Aptos SDK client instance.
 * @returns {Promise<{vaults: Array<{id: number, name: string, asset: string, apy: number, tvl: number, strategy: string}>, error: string | null}>}
 */
export const fetchVaultsState = async (client) => {
  try {
    const result = await tryViewFunctions(client, VIEW_FUNCTIONS.getVaults);

    if (result === null) {
      const message = "Canopy vaults temporarily unavailable. Try again later.";
      console.error("[canopyService] Failed to fetch vaults", message);
      return { vaults: [], error: message };
    }

    const vaults = safeArray(result).map(normalizeVault);
    return { vaults, error: null };
  } catch (error) {
    console.error("[canopyService] Failed to fetch vaults", error);
    return { vaults: [], error: "Canopy vaults temporarily unavailable. Try again later." };
  }
};

/**
 * Fetches all available Canopy vaults from the core vaults contract.
 *
 * @param {object} client Aptos SDK client instance.
 * @returns {Promise<Array<{id: number, name: string, asset: string, apy: number, tvl: number, strategy: string}>>}
 */
export const getVaults = async (client) => {
  try {
    const { vaults } = await fetchVaultsState(client);
    return vaults;
  } catch (error) {
    console.error("[canopyService] Failed to fetch vaults", error);
    return [];
  }
};

/**
 * Fetches the connected wallet's Canopy positions across vaults.
 *
 * @param {object} client Aptos SDK client instance.
 * @param {string|object} walletAddress Wallet address or wallet adapter address object.
 * @returns {Promise<Array<{vaultId: number, vaultName: string, deposited: number, currentValue: number, pendingRewards: number}>>}
 */
export const getUserPositions = async (client, walletAddress) => {
  try {
    const normalizedAddress = normalizeAddress(walletAddress);
    if (!normalizedAddress) {
      return [];
    }

    const result = await tryViewFunctions(client, VIEW_FUNCTIONS.getUserPositions, [normalizedAddress]);
    const positions = safeArray(result);
    return positions.map(normalizeUserPosition).filter((position) => position.deposited > 0 || position.currentValue > 0 || position.pendingRewards > 0);
  } catch (error) {
    console.error("[canopyService] Failed to fetch user positions", error);
    return [];
  }
};

/**
 * Fetches the wallet's pending Canopy rewards from the rewards contract.
 *
 * @param {object} client Aptos SDK client instance.
 * @param {string|object} walletAddress Wallet address or wallet adapter address object.
 * @returns {Promise<{totalRewards: number, breakdown: Array<{token: string, amount: number}>}>}
 */
export const getPendingRewards = async (client, walletAddress) => {
  try {
    const normalizedAddress = normalizeAddress(walletAddress);
    if (!normalizedAddress) {
      return { totalRewards: 0, breakdown: [] };
    }

    const result = await tryViewFunctions(client, VIEW_FUNCTIONS.getPendingRewards, [normalizedAddress]);

    if (!result) {
      return { totalRewards: 0, breakdown: [] };
    }

    if (Array.isArray(result) && result.every((entry) => Array.isArray(entry) || typeof entry === "object")) {
      const breakdown = result.map(normalizeRewardBreakdown).filter((entry) => entry.amount > 0);
      return {
        totalRewards: breakdown.reduce((sum, entry) => sum + entry.amount, 0),
        breakdown,
      };
    }

    const breakdownSource = safeArray(getValue(result, ["breakdown", "rewards", "items"], []));
    const breakdown = breakdownSource.map(normalizeRewardBreakdown).filter((entry) => entry.amount > 0);
    const totalRewards = toNumber(getValue(result, ["totalRewards", "total_rewards", "total"]), breakdown.reduce((sum, entry) => sum + entry.amount, 0));

    return { totalRewards, breakdown };
  } catch (error) {
    console.error("[canopyService] Failed to fetch pending rewards", error);
    return { totalRewards: 0, breakdown: [] };
  }
};

/**
 * Submits a Canopy deposit transaction through the core router.
 *
 * @param {Function} signAndSubmitTransaction Wallet adapter transaction submitter.
 * @param {string|object} sender Wallet address or wallet adapter address object.
 * @param {number|string} vaultId Target vault identifier.
 * @param {number|string|bigint} amount Deposit amount in on-chain base units.
 * @param {string} coinType Aptos coin type for the deposited asset.
 * @returns {Promise<string|null>} Transaction hash when available.
 */
export const deposit = async (signAndSubmitTransaction, sender, vaultId, amount, coinType) => {
  try {
    return await trySubmitTransaction(
      signAndSubmitTransaction,
      sender,
      ENTRY_FUNCTIONS.deposit,
      [vaultId, amount],
      coinType ? [coinType] : []
    );
  } catch (error) {
    console.error("[canopyService] Failed to submit deposit", error);
    return null;
  }
};

/**
 * Submits a Canopy withdrawal transaction through the core router.
 *
 * @param {Function} signAndSubmitTransaction Wallet adapter transaction submitter.
 * @param {string|object} sender Wallet address or wallet adapter address object.
 * @param {number|string} vaultId Target vault identifier.
 * @param {number|string|bigint} amount Withdrawal amount in on-chain base units.
 * @returns {Promise<string|null>} Transaction hash when available.
 */
export const withdraw = async (signAndSubmitTransaction, sender, vaultId, amount) => {
  try {
    return await trySubmitTransaction(
      signAndSubmitTransaction,
      sender,
      ENTRY_FUNCTIONS.withdraw,
      [vaultId, amount]
    );
  } catch (error) {
    console.error("[canopyService] Failed to submit withdrawal", error);
    return null;
  }
};

/**
 * Submits a Canopy reward claim transaction.
 *
 * @param {Function} signAndSubmitTransaction Wallet adapter transaction submitter.
 * @param {string|object} sender Wallet address or wallet adapter address object.
 * @returns {Promise<string|null>} Transaction hash when available.
 */
export const claimRewards = async (signAndSubmitTransaction, sender) => {
  try {
    return await trySubmitTransaction(signAndSubmitTransaction, sender, ENTRY_FUNCTIONS.claimRewards);
  } catch (error) {
    console.error("[canopyService] Failed to claim rewards", error);
    return null;
  }
};

/**
 * Fetches the current APY for a specific Canopy vault.
 *
 * @param {object} client Aptos SDK client instance.
 * @param {number|string} vaultId Target vault identifier.
 * @returns {Promise<{apy: number, apyFormatted: string}>}
 */
export const getVaultAPY = async (client, vaultId) => {
  try {
    const result = await tryViewFunctions(client, VIEW_FUNCTIONS.getVaultApy, [vaultId]);
    const apy = Array.isArray(result) ? toNumber(result[0], 0) : toNumber(getValue(result, ["apy", "apr", "value"]), 0);
    return {
      apy,
      apyFormatted: formatPercent(apy),
    };
  } catch (error) {
    console.error("[canopyService] Failed to fetch vault APY", error);
    return {
      apy: 0,
      apyFormatted: formatPercent(0),
    };
  }
};
