import { NETWORKS } from './networks.js';

const resolveNetwork = () => {
  const network = String(process.env.VITE_NETWORK || process.env.NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet' ? NETWORKS.TESTNET : NETWORKS.MAINNET;
};

const getIndexerEndpoint = () => resolveNetwork().indexer;

const queryIndexer = async (query, variables = {}) => {
  const response = await fetch(getIndexerEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
};

const normalizeAddress = (address) => {
  if (!address) return '';
  let normalized = String(address).trim().toLowerCase();
  if (!normalized.startsWith('0x')) normalized = `0x${normalized}`;
  return normalized;
};

export const checkAccountExists = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress || normalizedAddress === '0x') {
    return { exists: false, txCount: 0 };
  }

  const query = `
    query CheckAccountExists($address: String!) {
      account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    return { exists: txCount > 0, txCount };
  } catch {
    return { exists: false, txCount: 0 };
  }
};

export const getWalletAge = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  const query = `
    query GetWalletAge($address: String!) {
      account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: asc }
        limit: 1
      ) {
        transaction_timestamp
      }
      account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    return {
      firstTxTimestamp: data?.account_transactions?.[0]?.transaction_timestamp || null,
      txCount: data?.account_transactions_aggregate?.aggregate?.count || 0,
    };
  } catch {
    return { firstTxTimestamp: null, txCount: 0 };
  }
};

export const getUserTokenBalances = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  const query = `
    query GetUserTokenBalances($address: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address }
          amount: { _gt: "0" }
        }
      ) {
        asset_type
        amount
      }
    }
  `;

  try {
    const data = await queryIndexer(query, { address: normalizedAddress });
    return data?.current_fungible_asset_balances || [];
  } catch {
    return [];
  }
};
