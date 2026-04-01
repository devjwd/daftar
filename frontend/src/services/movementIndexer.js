import { DEFAULT_NETWORK } from "../config/network.js";

const REQUEST_TIMEOUT_MS = 10_000;
const PROTOCOL_NAMES = ["Echelon", "LayerBank", "Canopy", "Yuzu", "Mosaic", "Meridian"];

const PROTOCOL_MATCHERS = {
  Echelon: ["echelon"],
  LayerBank: ["layerbank", "layer_bank"],
  Canopy: ["canopy"],
  Yuzu: ["yuzu"],
  Mosaic: ["mosaic"],
  Meridian: ["meridian"],
};

const resolveEnv = () => {
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};

  const rpcUrl =
    String(env.VITE_MOVEMENT_RPC_URL || DEFAULT_NETWORK.rpc || "").trim() || null;

  const indexerUrl =
    String(env.VITE_MOVEMENT_INDEXER_URL || DEFAULT_NETWORK.indexer || "").trim() ||
    null;

  const mosaicApiUrl = String(env.VITE_MOSAIC_API_URL || "https://api.mosaic.ag/v1").trim();

  return { rpcUrl, indexerUrl, mosaicApiUrl };
};

const normalizeAddress = (walletAddress) => {
  const raw = String(walletAddress || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
};

const isValidAddress = (walletAddress) => /^0x[a-f0-9]{1,128}$/i.test(String(walletAddress || "").trim());

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const queryIndexer = async (query, variables = {}) => {
  const { indexerUrl } = resolveEnv();
  if (!indexerUrl) {
    return { data: null, error: "Indexer endpoint is not configured" };
  }

  try {
    const response = await fetchWithTimeout(indexerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      return {
        data: null,
        error: `Indexer request failed (${response.status} ${response.statusText})`,
      };
    }

    const json = await parseJsonSafe(response);
    if (!json) {
      return { data: null, error: "Indexer returned invalid JSON" };
    }

    if (Array.isArray(json.errors) && json.errors.length) {
      const firstMessage = String(json.errors[0]?.message || "Unknown GraphQL error");
      return { data: null, error: `Indexer GraphQL error: ${firstMessage}` };
    }

    return { data: json.data || null, error: null };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `Indexer request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Indexer request failed: ${String(error?.message || error)}`;
    return { data: null, error: message };
  }
};

const postRpcView = async ({ functionName, typeArguments = [], functionArguments = [] }) => {
  const { rpcUrl } = resolveEnv();
  if (!rpcUrl) {
    return { data: null, error: "MOVEMENT_RPC_URL is not configured" };
  }

  const endpoint = `${rpcUrl.replace(/\/+$/, "")}/view`;

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: functionName,
        type_arguments: typeArguments,
        arguments: functionArguments,
      }),
    });

    if (!response.ok) {
      return {
        data: null,
        error: `RPC view request failed (${response.status} ${response.statusText})`,
      };
    }

    const json = await parseJsonSafe(response);
    return { data: json, error: null };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `RPC view request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `RPC view request failed: ${String(error?.message || error)}`;
    return { data: null, error: message };
  }
};

const parseFirstNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const parseCoinTypeOwnerAddress = (coinType) => {
  const value = String(coinType || "").trim();
  const [addr] = value.split("::");
  const normalized = normalizeAddress(addr);
  return isValidAddress(normalized) ? normalized : null;
};

const extractProtocolMatches = (rows = []) => {
  const matched = new Set();

  for (const row of rows) {
    const text = [
      row?.entry_function_id_str,
      row?.entry_function_contract_address,
      row?.entry_function_module_name,
      row?.entry_function_function_name,
      row?.transaction_block_height,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!text) continue;

    for (const protocolName of PROTOCOL_NAMES) {
      const keywords = PROTOCOL_MATCHERS[protocolName] || [];
      if (keywords.some((k) => text.includes(k))) {
        matched.add(protocolName);
      }
    }
  }

  return Array.from(matched);
};

export const getTransactionCount = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) {
      return { count: 0, error: "Invalid wallet address" };
    }

    const query = `
      query TxCount($address: String!) {
        account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
          aggregate {
            count
          }
        }
      }
    `;

    const { data, error } = await queryIndexer(query, { address });
    if (error) {
      return { count: 0, error };
    }

    const count = parseFirstNumber(data?.account_transactions_aggregate?.aggregate?.count);
    return { count, error: null };
  } catch (error) {
    return { count: 0, error: String(error?.message || error) };
  }
};

export const getDaysOnchain = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) {
      return { days: 0, firstTxAt: null, error: "Invalid wallet address" };
    }

    const query = `
      query FirstTx($address: String!) {
        account_transactions(
          where: { account_address: { _eq: $address } }
          order_by: { transaction_version: asc }
          limit: 1
        ) {
          transaction_timestamp
        }
      }
    `;

    const { data, error } = await queryIndexer(query, { address });
    if (error) {
      return { days: 0, firstTxAt: null, error };
    }

    const firstTxAt = data?.account_transactions?.[0]?.transaction_timestamp || null;
    if (!firstTxAt) {
      return { days: 0, firstTxAt: null, error: "No transaction history found" };
    }

    const firstMs = new Date(firstTxAt).getTime();
    if (!Number.isFinite(firstMs)) {
      return { days: 0, firstTxAt: null, error: "Invalid first transaction timestamp" };
    }

    const days = Math.max(0, Math.floor((Date.now() - firstMs) / 86_400_000));
    return { days, firstTxAt, error: null };
  } catch (error) {
    return { days: 0, firstTxAt: null, error: String(error?.message || error) };
  }
};

export const getProtocolCount = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) {
      return { count: 0, protocols: [], error: "Invalid wallet address" };
    }

    const query = `
      query UserTxProtocols($address: String!) {
        user_transactions(
          where: { sender: { _eq: $address } }
          order_by: { version: desc }
          limit: 1000
        ) {
          entry_function_id_str
          entry_function_contract_address
          entry_function_module_name
          entry_function_function_name
        }
      }
    `;

    const { data, error } = await queryIndexer(query, { address });
    if (error) {
      return { count: 0, protocols: [], error };
    }

    const protocols = extractProtocolMatches(data?.user_transactions || []);
    return {
      count: protocols.length,
      protocols,
      error: null,
    };
  } catch (error) {
    return { count: 0, protocols: [], error: String(error?.message || error) };
  }
};

export const getDexVolume = async (walletAddress) => {
  const address = normalizeAddress(walletAddress);
  if (!isValidAddress(address)) {
    return { volumeUsd: 0, error: "Invalid wallet address" };
  }

  const { mosaicApiUrl } = resolveEnv();
  const endpoint = `${mosaicApiUrl.replace(/\/+$/, "")}/accounts/${encodeURIComponent(address)}/volume`;

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        volumeUsd: 0,
        error: `Mosaic API request failed (${response.status} ${response.statusText})`,
      };
    }

    const json = await parseJsonSafe(response);
    const volumeUsd = parseFirstNumber(json?.volume ?? json?.total_volume ?? 0);

    return { volumeUsd, error: null };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `Mosaic API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Mosaic API request failed: ${String(error?.message || error)}`;
    return { volumeUsd: 0, error: message };
  }
};

export const getTokenBalance = async (walletAddress, coinType) => {
  try {
    const address = normalizeAddress(walletAddress);
    const normalizedCoinType = String(coinType || "").trim();

    if (!isValidAddress(address)) {
      return { balance: 0, decimals: 8, error: "Invalid wallet address" };
    }

    if (!normalizedCoinType.includes("::")) {
      return { balance: 0, decimals: 8, error: "Invalid coin type" };
    }

    const balanceResult = await postRpcView({
      functionName: "0x1::coin::balance",
      typeArguments: [normalizedCoinType],
      functionArguments: [address],
    });

    if (balanceResult.error) {
      return { balance: 0, decimals: 8, error: balanceResult.error };
    }

    const rawBalance = Array.isArray(balanceResult.data)
      ? balanceResult.data[0]
      : balanceResult.data?.[0] ?? 0;

    let decimals = 8;
    const coinInfoOwner = parseCoinTypeOwnerAddress(normalizedCoinType);
    if (coinInfoOwner) {
      const { rpcUrl } = resolveEnv();
      const resourceType = `0x1::coin::CoinInfo<${normalizedCoinType}>`;
      const resourceEndpoint = `${rpcUrl.replace(/\/+$/, "")}/accounts/${coinInfoOwner}/resource/${encodeURIComponent(resourceType)}`;

      try {
        const response = await fetchWithTimeout(resourceEndpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          const json = await parseJsonSafe(response);
          const maybeDecimals = Number(json?.data?.decimals);
          if (Number.isFinite(maybeDecimals)) {
            decimals = maybeDecimals;
          }
        }
      } catch {
        // Keep default decimals when coin info lookup fails.
      }
    }

    return {
      balance: parseFirstNumber(rawBalance),
      decimals,
      error: null,
    };
  } catch (error) {
    return { balance: 0, decimals: 8, error: String(error?.message || error) };
  }
};

const checkMinThreshold = (actual, minRequired) => Number(actual) >= Number(minRequired || 0);

export const checkAllEligibility = async (walletAddress, badgeDefinition) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) {
      return {
        eligible: false,
        reason: "Invalid wallet address",
        data: {},
      };
    }

    const ruleType = String(badgeDefinition?.rule_type || "").trim().toLowerCase();
    const params =
      badgeDefinition?.rule_params && typeof badgeDefinition.rule_params === "object"
        ? badgeDefinition.rule_params
        : {};

    switch (ruleType) {
      case "transaction_count": {
        const result = await getTransactionCount(address);
        const minCount = Number(params.minCount ?? params.min ?? 1);
        if (result.error) {
          return { eligible: false, reason: `Unable to verify transaction count: ${result.error}`, data: result };
        }
        const eligible = checkMinThreshold(result.count, minCount);
        return {
          eligible,
          reason: eligible
            ? `Wallet has ${result.count} transactions (required: ${minCount})`
            : `Wallet has ${result.count} transactions, needs ${minCount}`,
          data: { ...result, minRequired: minCount },
        };
      }

      case "days_onchain": {
        const result = await getDaysOnchain(address);
        const minDays = Number(params.minDays ?? params.min ?? 1);
        if (result.error) {
          return { eligible: false, reason: `Unable to verify days on-chain: ${result.error}`, data: result };
        }
        const eligible = checkMinThreshold(result.days, minDays);
        return {
          eligible,
          reason: eligible
            ? `Wallet age is ${result.days} days (required: ${minDays})`
            : `Wallet age is ${result.days} days, needs ${minDays}`,
          data: { ...result, minRequired: minDays },
        };
      }

      case "protocol_count": {
        const result = await getProtocolCount(address);
        const minProtocols = Number(params.minProtocols ?? params.min ?? 1);
        if (result.error) {
          return { eligible: false, reason: `Unable to verify protocol usage: ${result.error}`, data: result };
        }
        const eligible = checkMinThreshold(result.count, minProtocols);
        return {
          eligible,
          reason: eligible
            ? `Wallet used ${result.count} tracked protocols (required: ${minProtocols})`
            : `Wallet used ${result.count} tracked protocols, needs ${minProtocols}`,
          data: { ...result, minRequired: minProtocols },
        };
      }

      case "dex_volume": {
        const result = await getDexVolume(address);
        const minVolume = Number(params.minVolume ?? params.minUsd ?? 0);
        if (result.error) {
          return { eligible: false, reason: `Unable to verify DEX volume: ${result.error}`, data: result };
        }
        const eligible = checkMinThreshold(result.volumeUsd, minVolume);
        return {
          eligible,
          reason: eligible
            ? `Wallet DEX volume is $${result.volumeUsd.toFixed(2)} (required: $${minVolume})`
            : `Wallet DEX volume is $${result.volumeUsd.toFixed(2)}, needs $${minVolume}`,
          data: { ...result, minRequired: minVolume },
        };
      }

      case "min_balance":
      case "token_holder": {
        const coinType = String(params.coinType || params.assetType || "").trim();
        const minAmount = Number(params.minAmount ?? params.min ?? 0);
        if (!coinType) {
          return { eligible: false, reason: "coinType is required in rule_params", data: {} };
        }

        const result = await getTokenBalance(address, coinType);
        if (result.error) {
          return { eligible: false, reason: `Unable to verify token balance: ${result.error}`, data: result };
        }

        const divisor = Math.pow(10, Number(result.decimals || 0));
        const humanBalance = divisor > 0 ? result.balance / divisor : result.balance;
        const eligible = checkMinThreshold(humanBalance, minAmount);

        return {
          eligible,
          reason: eligible
            ? `Token balance is ${humanBalance} (required: ${minAmount})`
            : `Token balance is ${humanBalance}, needs ${minAmount}`,
          data: {
            ...result,
            coinType,
            humanBalance,
            minRequired: minAmount,
          },
        };
      }

      default:
        return {
          eligible: false,
          reason: `Unsupported rule_type: ${ruleType || "(empty)"}`,
          data: {
            supportedRuleTypes: [
              "transaction_count",
              "days_onchain",
              "protocol_count",
              "dex_volume",
              "min_balance",
              "token_holder",
            ],
          },
        };
    }
  } catch (error) {
    return {
      eligible: false,
      reason: `Eligibility check failed: ${String(error?.message || error)}`,
      data: {},
    };
  }
};

export default {
  getTransactionCount,
  getDaysOnchain,
  getProtocolCount,
  getDexVolume,
  getTokenBalance,
  checkAllEligibility,
};
