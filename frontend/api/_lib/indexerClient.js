/**
 * Movement Network Indexer GraphQL client for serverless API routes.
 * Shared by the serverless API routes.
 */

const NETWORKS = {
  mainnet: 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql',
  testnet: 'https://hasura.testnet.movementnetwork.xyz/v1/graphql',
};

const getEndpoint = () => {
  const network = String(process.env.VITE_NETWORK || process.env.NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet' ? NETWORKS.testnet : NETWORKS.mainnet;
};

const normalizeAddress = (address) => {
  if (!address) return '';
  let n = String(address).trim().toLowerCase();
  if (!n.startsWith('0x')) n = `0x${n}`;
  return n;
};

export const queryIndexer = async (query, variables = {}) => {
  const res = await fetch(getEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Indexer ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
};

export const checkAccountExists = async (address) => {
  const addr = normalizeAddress(address);
  if (!addr || addr === '0x') return { exists: false, txCount: 0 };

  const query = `
    query CheckAccount($address: String!) {
      account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
        aggregate { count }
      }
    }
  `;
  try {
    const data = await queryIndexer(query, { address: addr });
    const txCount = data?.account_transactions_aggregate?.aggregate?.count || 0;
    return { exists: txCount > 0, txCount };
  } catch {
    return { exists: false, txCount: 0 };
  }
};

export const getWalletAge = async (address) => {
  const addr = normalizeAddress(address);
  const query = `
    query WalletAge($address: String!) {
      account_transactions(
        where: { account_address: { _eq: $address } }
        order_by: { transaction_version: asc }
        limit: 1
      ) { transaction_timestamp }
      account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
        aggregate { count }
      }
    }
  `;
  try {
    const data = await queryIndexer(query, { address: addr });
    return {
      firstTxTimestamp: data?.account_transactions?.[0]?.transaction_timestamp || null,
      txCount: data?.account_transactions_aggregate?.aggregate?.count || 0,
    };
  } catch {
    return { firstTxTimestamp: null, txCount: 0 };
  }
};

export const getUserTokenBalances = async (address) => {
  const addr = normalizeAddress(address);
  const query = `
    query Balances($address: String!) {
      current_fungible_asset_balances(
        where: { owner_address: { _eq: $address }, amount: { _gt: "0" } }
      ) { asset_type amount }
    }
  `;
  try {
    const data = await queryIndexer(query, { address: addr });
    return data?.current_fungible_asset_balances || [];
  } catch {
    return [];
  }
};
