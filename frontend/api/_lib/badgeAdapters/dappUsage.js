/**
 * dApp Usage Badge Adapter
 * 
 * Checks if a user has interacted with a specific dApp contract.
 * Queries the indexer for transactions involving the dApp address.
 */
import { queryIndexer } from '../indexerClient.js';

const DAPP_INTERACTIONS_QUERY = `
  query GetDappInteractions($address: String!, $dappAddress: String!) {
    account_transactions(
      where: {
        account_address: { _eq: $address }
        _or: [
          { transaction: { payload: { _contains: { function: $dappAddress } } } }
          { transaction: { events: { account_address: { _eq: $dappAddress } } } }
        ]
      }
      order_by: { transaction_version: desc }
    ) {
      transaction_version
    }
  }
`;

export async function check(address, params = {}) {
  if (!address) return [];
  
  const dappAddress = params.dappAddress || params.contractAddress;
  if (!dappAddress) return [];
  
  const minInteractions = Number(params.minInteractions ?? params.min ?? 1);
  
  try {
    const result = await queryIndexer(DAPP_INTERACTIONS_QUERY, {
      address: address.toLowerCase(),
      dappAddress: dappAddress.toLowerCase(),
    });
    
    const interactions = result?.account_transactions?.length || 0;
    
    if (interactions < minInteractions) return [];
    
    return [{
      badgeId: params.badgeId || `dapp-usage-${dappAddress.slice(0, 10)}`,
      extra: {
        dappAddress,
        interactions,
        dappName: params.dappName || 'Unknown dApp',
      },
    }];
  } catch (err) {
    console.warn('[dappUsage] check failed', err.message);
    return [];
  }
}

export default { check };
