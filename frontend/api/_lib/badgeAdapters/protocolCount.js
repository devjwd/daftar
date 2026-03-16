/**
 * Protocol Count Badge Adapter
 * 
 * Checks if a user has interacted with a minimum number of DeFi protocols.
 * Queries the indexer for unique protocol interactions.
 */
import { queryIndexer } from '../indexerClient.js';

// Known DeFi protocol addresses on Movement
const KNOWN_PROTOCOLS = [
  // DEXes
  'liquidswap',
  'pontem',
  'cellana',
  'thala',
  // Lending
  'echelon',
  'joule',
  'aries',
  // Others
  'merkle',
  'amnis',
];

const PROTOCOL_ADDRESSES_QUERY = `
  query GetProtocolInteractions($address: String!) {
    account_transactions(
      where: { account_address: { _eq: $address } }
      order_by: { transaction_version: desc }
      limit: 1000
    ) {
      transaction_version
      transaction {
        payload
      }
    }
  }
`;

function extractProtocolFromPayload(payload) {
  if (!payload || !payload.function) return null;
  
  const fn = payload.function.toLowerCase();
  
  // Check for known protocol patterns
  for (const protocol of KNOWN_PROTOCOLS) {
    if (fn.includes(protocol)) {
      return protocol;
    }
  }
  
  // Extract module address
  const match = fn.match(/^(0x[a-f0-9]+)::/);
  if (match) {
    return match[1];
  }
  
  return null;
}

export async function check(address, params = {}) {
  if (!address) return [];
  
  const minProtocols = Number(params.minProtocols ?? params.min ?? 1);
  
  try {
    const result = await queryIndexer(PROTOCOL_ADDRESSES_QUERY, {
      address: address.toLowerCase(),
    });
    
    const transactions = result?.account_transactions || [];
    const protocols = new Set();
    
    for (const tx of transactions) {
      const protocol = extractProtocolFromPayload(tx?.transaction?.payload);
      if (protocol) {
        protocols.add(protocol);
      }
    }
    
    const protocolCount = protocols.size;
    
    if (protocolCount < minProtocols) return [];
    
    return [{
      badgeId: params.badgeId || `protocol-explorer-${minProtocols}`,
      extra: {
        protocolCount,
        protocols: Array.from(protocols),
      },
    }];
  } catch (err) {
    console.warn('[protocolCount] check failed', err.message);
    return [];
  }
}

export default { check };
