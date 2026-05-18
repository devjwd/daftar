export const TRADEPORT_TYPES = {
  NFT_SALE: "NFT_SALE",
  NFT_BUY: "NFT_BUY",
  NFT_LIST: "NFT_LIST",
  NFT_BID: "NFT_BID"
};

// Maps Tradeport function suffixes to their high-fidelity action types
export const TRADEPORT_SUFFIX_MAP: Record<string, string> = {
  buy_token: TRADEPORT_TYPES.NFT_BUY,
  buy_tokens: TRADEPORT_TYPES.NFT_BUY,
  buy_tokens_v2: TRADEPORT_TYPES.NFT_BUY,
  list_token: TRADEPORT_TYPES.NFT_LIST,
  list_tokens: TRADEPORT_TYPES.NFT_LIST,
  list_tokens_v2: TRADEPORT_TYPES.NFT_LIST,
  unlist_token: TRADEPORT_TYPES.NFT_LIST,
  unlist_tokens: TRADEPORT_TYPES.NFT_LIST,
  relist_token: TRADEPORT_TYPES.NFT_LIST,
  relist_tokens: TRADEPORT_TYPES.NFT_LIST,
  collection_bid: TRADEPORT_TYPES.NFT_BID,
  collection_bids: TRADEPORT_TYPES.NFT_BID,
  token_bid: TRADEPORT_TYPES.NFT_BID,
  token_bids: TRADEPORT_TYPES.NFT_BID,
  cancel_collection_bid: TRADEPORT_TYPES.NFT_BID,
  cancel_token_bid: TRADEPORT_TYPES.NFT_BID,
  accept_collection_bid: TRADEPORT_TYPES.NFT_SALE,
  accept_token_bid: TRADEPORT_TYPES.NFT_SALE,
  unlist_and_accept_collection_bid: TRADEPORT_TYPES.NFT_SALE,
  unlist_and_accept_token_bid: TRADEPORT_TYPES.NFT_SALE,
};

/**
 * Custom high-fidelity override for Tradeport NFT Buy/Accept Bid transactions.
 * Extracts accurate NFT and payment (MOVE) flow with precise marketplace price.
 */
export function processTradeportAssets(
  suffix: string,
  events: any[],
  primaryIn: any,
  primaryOut: any
) {
  const isBuy = suffix.includes('buy');
  const isAccept = suffix.includes('accept');

  // Compute gross price by summing all valid MOVE deposits in the transaction
  const moveDeposits = events.filter(e => {
    const type = String(e.type || e.activity_type || '').toLowerCase();
    const asset = String(e.asset_type || e.coin_type || '').toLowerCase();
    return type.includes('deposit') && (
      asset.includes('aptos_coin') || 
      asset.includes('0x1') || 
      asset.includes('0x000000000000000000000000000000000000000000000000000000000000000a')
    );
  });

  // De-duplicate deposits by owner and raw amount to avoid double-counting due to coin-to-fungible-asset mirroring
  const seenDeposits = new Set<string>();
  const grossPrice = moveDeposits.reduce((sum, e) => {
    const owner = String(e.owner_address || e.owner || '').toLowerCase();
    const amountRaw = String(e.amount || 0);
    const key = `${owner}:${amountRaw}`;
    
    if (seenDeposits.has(key)) return sum;
    seenDeposits.add(key);

    const decimals = e.metadata?.decimals || 8;
    const amount = Number(e.amount) / Math.pow(10, decimals);
    if (amount < 0.005) return sum; // Ignore small gas refund deposits
    return sum + amount;
  }, 0);

  let resolvedIn = primaryIn;
  let resolvedOut = primaryOut;

  if (isBuy) {
    resolvedIn = { symbol: 'NFT', amount: 1, direction: 'in', assetType: 'NFT' };
    resolvedOut = { symbol: 'MOVE', amount: grossPrice || primaryOut?.amount || 0, direction: 'out', assetType: '0x1::aptos_coin::AptosCoin' };
  } else if (isAccept) {
    resolvedIn = { symbol: 'MOVE', amount: grossPrice || primaryIn?.amount || 0, direction: 'in', assetType: '0x1::aptos_coin::AptosCoin' };
    resolvedOut = { symbol: 'NFT', amount: 1, direction: 'out', assetType: 'NFT' };
  } else if (suffix.includes('bid')) {
    resolvedIn = null;
    resolvedOut = { symbol: 'MOVE', amount: grossPrice || primaryOut?.amount || 0, direction: 'out', assetType: '0x1::aptos_coin::AptosCoin' };
  }

  return { primaryIn: resolvedIn, primaryOut: resolvedOut };
}

/**
 * Generates custom humanized descriptions specifically for Tradeport NFT interactions.
 */
export function generateTradeportDescription(
  suffix: string,
  events: any[],
  primaryIn: any,
  primaryOut: any
): string {
  // Compute gross price by summing all valid MOVE deposits in the transaction
  const moveDeposits = events.filter(e => {
    const type = String(e.type || e.activity_type || '').toLowerCase();
    const asset = String(e.asset_type || e.coin_type || '').toLowerCase();
    return type.includes('deposit') && (
      asset.includes('aptos_coin') || 
      asset.includes('0x1') || 
      asset.includes('0x000000000000000000000000000000000000000000000000000000000000000a')
    );
  });

  // De-duplicate deposits by owner and raw amount to avoid double-counting due to coin-to-fungible-asset mirroring
  const seenDeposits = new Set<string>();
  const grossPrice = moveDeposits.reduce((sum, e) => {
    const owner = String(e.owner_address || e.owner || '').toLowerCase();
    const amountRaw = String(e.amount || 0);
    const key = `${owner}:${amountRaw}`;
    
    if (seenDeposits.has(key)) return sum;
    seenDeposits.add(key);

    const decimals = e.metadata?.decimals || 8;
    const amount = Number(e.amount) / Math.pow(10, decimals);
    if (amount < 0.005) return sum; // Ignore small gas refund deposits
    return sum + amount;
  }, 0);

  const listEvt = events.find(e => String(e.type || '').toLowerCase().includes('listings_v2::insertlistingevent'));
  const bidEvt = events.find(e => String(e.type || '').toLowerCase().includes('biddings_v2::insert'));

  if (suffix.includes('buy_token')) {
    const price = grossPrice || primaryOut?.amount || null;
    return price ? `Bought NFT for ${price.toFixed(2)} MOVE on Tradeport` : `Bought NFT on Tradeport`;
  }
  
  if (suffix.includes('list_token')) {
    const price = listEvt?.data?.price ? Number(listEvt.data.price) / 1e8 : null;
    return price ? `Listed NFT for sale at ${price.toFixed(2)} MOVE on Tradeport` : `Listed NFT for sale on Tradeport`;
  }
  
  if (suffix.includes('relist_token')) {
    const price = listEvt?.data?.price ? Number(listEvt.data.price) / 1e8 : null;
    return price ? `Updated NFT listed price to ${price.toFixed(2)} MOVE on Tradeport` : `Updated NFT listed price on Tradeport`;
  }
  
  if (suffix.includes('unlist_token')) {
    return `Unlisted NFT from sale on Tradeport`;
  }
  
  if (suffix.includes('bid')) {
    if (suffix.includes('accept') || suffix.includes('accept_token_bid') || suffix.includes('accept_collection_bid')) {
      const price = grossPrice || primaryIn?.amount || null;
      return price ? `Accepted NFT Bid of ${price.toFixed(2)} MOVE on Tradeport` : `Accepted NFT Bid on Tradeport`;
    }
    const price = grossPrice || (bidEvt?.data?.price ? Number(bidEvt.data.price) / 1e8 : null) || primaryOut?.amount;
    return price ? `Placed Bid of ${price.toFixed(2)} MOVE on Tradeport` : `Placed NFT Bid on Tradeport`;
  }
  
  if (suffix.includes('cancel')) {
    return `Canceled NFT Bid on Tradeport`;
  }

  return `${suffix.charAt(0).toUpperCase() + suffix.slice(1).replace(/_/g, ' ')} via Tradeport`;
}
