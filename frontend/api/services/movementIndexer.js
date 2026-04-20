const REQUEST_TIMEOUT_MS = 10_000;
const PROTOCOL_NAMES = ['Echelon', 'LayerBank', 'Canopy', 'Yuzu', 'Mosaic', 'Meridian'];

const PROTOCOL_MATCHERS = {
  Echelon: ['echelon'],
  LayerBank: ['layerbank', 'layer_bank'],
  Canopy: ['canopy'],
  Yuzu: ['yuzu'],
  Mosaic: ['mosaic'],
  Meridian: ['meridian'],
};

const NETWORKS = {
  mainnet: {
    rpc: 'https://mainnet.movementnetwork.xyz/v1',
    indexer: 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql',
  },
  testnet: {
    rpc: 'https://testnet.movementnetwork.xyz/v1',
    indexer: 'https://hasura.testnet.movementnetwork.xyz/v1/graphql',
  },
};

const resolveEnv = () => {
  const network = String(process.env.VITE_NETWORK || process.env.NETWORK || 'mainnet').toLowerCase();
  const defaults = network === 'testnet' ? NETWORKS.testnet : NETWORKS.mainnet;

  const rpcUrl = String(process.env.MOVEMENT_RPC_URL || defaults.rpc || '').trim() || null;
  const indexerUrl = String(process.env.MOVEMENT_INDEXER_URL || defaults.indexer || '').trim() || null;
  const mosaicApiUrl = String(process.env.MOSAIC_API_URL || process.env.VITE_MOSAIC_API_URL || 'https://api.mosaic.ag/v1').trim();

  return { rpcUrl, indexerUrl, mosaicApiUrl };
};

const normalizeAddress = (walletAddress) => {
  const raw = String(walletAddress || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const isValidAddress = (walletAddress) => /^0x[a-f0-9]{1,128}$/i.test(String(walletAddress || '').trim());

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
    return { data: null, error: 'Indexer endpoint is not configured' };
  }

  try {
    const response = await fetchWithTimeout(indexerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      return {
        data: null,
        error: `Indexer request failed (${response.status} ${response.statusText})`,
      };
    }

    const json = await parseJsonSafe(response);
    if (!json) return { data: null, error: 'Indexer returned invalid JSON' };
    if (Array.isArray(json.errors) && json.errors.length) {
      return { data: null, error: `Indexer GraphQL error: ${String(json.errors[0]?.message || 'Unknown error')}` };
    }

    return { data: json.data || null, error: null };
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? `Indexer request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Indexer request failed: ${String(error?.message || error)}`;
    return { data: null, error: message };
  }
};

const postRpcView = async ({ functionName, typeArguments = [], functionArguments = [] }) => {
  const { rpcUrl } = resolveEnv();
  if (!rpcUrl) {
    return { data: null, error: 'MOVEMENT_RPC_URL is not configured' };
  }

  const endpoint = `${rpcUrl.replace(/\/+$/, '')}/view`;

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    return { data: await parseJsonSafe(response), error: null };
  } catch (error) {
    const message =
      error?.name === 'AbortError'
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
  const value = String(coinType || '').trim();
  const [addr] = value.split('::');
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
    ].filter(Boolean).join(' ').toLowerCase();

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
    if (!isValidAddress(address)) return { count: 0, error: 'Invalid wallet address' };

    const query = `
      query TxCount($address: String!) {
        account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
          aggregate { count }
        }
      }
    `;

    const { data, error } = await queryIndexer(query, { address });
    if (error) return { count: 0, error };
    return { count: parseFirstNumber(data?.account_transactions_aggregate?.aggregate?.count), error: null };
  } catch (error) {
    return { count: 0, error: String(error?.message || error) };
  }
};

export const getDaysOnchain = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) return { days: 0, firstTxAt: null, error: 'Invalid wallet address' };

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
    if (error) return { days: 0, firstTxAt: null, error };

    const firstTxAt = data?.account_transactions?.[0]?.transaction_timestamp || null;
    if (!firstTxAt) return { days: 0, firstTxAt: null, error: 'No transaction history found' };

    const firstMs = new Date(firstTxAt).getTime();
    if (!Number.isFinite(firstMs)) return { days: 0, firstTxAt: null, error: 'Invalid first transaction timestamp' };

    const days = Math.max(0, Math.floor((Date.now() - firstMs) / 86_400_000));
    return { days, firstTxAt, error: null };
  } catch (error) {
    return { days: 0, firstTxAt: null, error: String(error?.message || error) };
  }
};

export const getProtocolCount = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) return { count: 0, protocols: [], error: 'Invalid wallet address' };

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
    if (error) return { count: 0, protocols: [], error };

    const protocols = extractProtocolMatches(data?.user_transactions || []);
    return { count: protocols.length, protocols, error: null };
  } catch (error) {
    return { count: 0, protocols: [], error: String(error?.message || error) };
  }
};

export const getDappUsage = async (walletAddress, criteria = {}) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) return { count: 0, error: 'Invalid wallet address' };

    const dappKey = String(criteria.dapp_key ?? criteria.dappKey ?? '').trim().toLowerCase();
    const dappName = String(criteria.dapp_name ?? criteria.dappName ?? '').trim().toLowerCase();
    const dappContract = normalizeAddress(criteria.dapp_contract ?? criteria.dappContract ?? '');

    if (!dappKey && !dappName && !dappContract) {
      return { count: 0, error: 'DAPP_USAGE requires dapp_key, dapp_name, or dapp_contract' };
    }

    const query = `
      query UserTxDappUsage($address: String!) {
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
    if (error) return { count: 0, error };

    const rows = Array.isArray(data?.user_transactions) ? data.user_transactions : [];
    const matches = rows.filter((row) => {
      const contractAddress = normalizeAddress(row?.entry_function_contract_address || '');
      const text = [
        row?.entry_function_id_str,
        row?.entry_function_module_name,
        row?.entry_function_function_name,
      ].filter(Boolean).join(' ').toLowerCase();

      return Boolean(
        (dappContract && contractAddress === dappContract)
          || (dappName && text.includes(dappName))
          || (dappKey && text.includes(dappKey))
      );
    });

    return { count: matches.length, error: null };
  } catch (error) {
    return { count: 0, error: String(error?.message || error) };
  }
};

export const getDexVolume = async (walletAddress) => {
  try {
    const address = normalizeAddress(walletAddress);
    if (!isValidAddress(address)) return { volumeUsd: 0, error: 'Invalid wallet address' };

    const { mosaicApiUrl } = resolveEnv();
    const endpoint = `${mosaicApiUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(address)}/volume`;
    const response = await fetchWithTimeout(endpoint, { method: 'GET', headers: { Accept: 'application/json' } });

    if (!response.ok) {
      return { volumeUsd: 0, error: `Mosaic API request failed (${response.status} ${response.statusText})` };
    }

    const json = await parseJsonSafe(response);
    return { volumeUsd: parseFirstNumber(json?.volume ?? json?.total_volume ?? 0), error: null };
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? `Mosaic API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Mosaic API request failed: ${String(error?.message || error)}`;
    return { volumeUsd: 0, error: message };
  }
};

export const getTokenBalance = async (walletAddress, coinType) => {
  try {
    const address = normalizeAddress(walletAddress);
    const normalizedCoinType = String(coinType || '').trim();

    if (!isValidAddress(address)) return { balance: 0, decimals: 8, error: 'Invalid wallet address' };
    if (!normalizedCoinType.includes('::')) return { balance: 0, decimals: 8, error: 'Invalid coin type' };

    const balanceResult = await postRpcView({
      functionName: '0x1::coin::balance',
      typeArguments: [normalizedCoinType],
      functionArguments: [address],
    });

    if (balanceResult.error) return { balance: 0, decimals: 8, error: balanceResult.error };

    const rawBalance = Array.isArray(balanceResult.data) ? balanceResult.data[0] : balanceResult.data?.[0] ?? 0;

    let decimals = 8;
    const coinInfoOwner = parseCoinTypeOwnerAddress(normalizedCoinType);
    if (coinInfoOwner) {
      const { rpcUrl } = resolveEnv();
      const resourceType = `0x1::coin::CoinInfo<${normalizedCoinType}>`;
      const resourceEndpoint = `${rpcUrl.replace(/\/+$/, '')}/accounts/${coinInfoOwner}/resource/${encodeURIComponent(resourceType)}`;

      try {
        const response = await fetchWithTimeout(resourceEndpoint, { method: 'GET', headers: { Accept: 'application/json' } });
        if (response.ok) {
          const json = await parseJsonSafe(response);
          const maybeDecimals = Number(json?.data?.decimals);
          if (Number.isFinite(maybeDecimals)) decimals = maybeDecimals;
        }
      } catch {
        // Keep default decimals when coin info lookup fails.
      }
    }

    return { balance: parseFirstNumber(rawBalance), decimals, error: null };
  } catch (error) {
    return { balance: 0, decimals: 8, error: String(error?.message || error) };
  }
};

export default {
  getTransactionCount,
  getDaysOnchain,
  getProtocolCount,
  getDappUsage,
  getDexVolume,
  getTokenBalance,
};
