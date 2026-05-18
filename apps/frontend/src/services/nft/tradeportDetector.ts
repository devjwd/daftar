export const NFT_TX_TYPES = {
  NFT_SALE: "nft_sale",
  NFT_BUY: "nft_buy",
  NFT_LIST: "nft_list",
  NFT_BID: "nft_bid",
};

// Custom premium visual configurations specifically for NFT operations
export const NFT_TX_VISUALS = {
  [NFT_TX_TYPES.NFT_SALE]: { label: "Accept Bid", icon: "🎨", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  [NFT_TX_TYPES.NFT_BUY]: { label: "Buy NFT", icon: "🖼️", color: "#3B82F6", bg: "rgba(59,130,246,0.1)" },
  [NFT_TX_TYPES.NFT_LIST]: { label: "List NFT", icon: "🏷️", color: "#EC4899", bg: "rgba(236,72,153,0.1)" },
  [NFT_TX_TYPES.NFT_BID]: { label: "Place Bid", icon: "📥", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
};

// Maps Tradeport suffixes to their custom types and labels
export const TRADEPORT_SUFFIX_MAP = {
  buy_token: { type: NFT_TX_TYPES.NFT_BUY, label: "Buy NFT" },
  buy_tokens: { type: NFT_TX_TYPES.NFT_BUY, label: "Buy NFTs" },
  buy_tokens_v2: { type: NFT_TX_TYPES.NFT_BUY, label: "Buy NFTs" },
  list_token: { type: NFT_TX_TYPES.NFT_LIST, label: "List NFT" },
  list_tokens: { type: NFT_TX_TYPES.NFT_LIST, label: "List NFTs" },
  list_tokens_v2: { type: NFT_TX_TYPES.NFT_LIST, label: "List NFTs" },
  unlist_token: { type: NFT_TX_TYPES.NFT_LIST, label: "Unlist NFT" },
  unlist_tokens: { type: NFT_TX_TYPES.NFT_LIST, label: "Unlist NFTs" },
  relist_token: { type: NFT_TX_TYPES.NFT_LIST, label: "Update Price" },
  relist_tokens: { type: NFT_TX_TYPES.NFT_LIST, label: "Update Prices" },
  collection_bid: { type: NFT_TX_TYPES.NFT_BID, label: "Place Bid" },
  collection_bids: { type: NFT_TX_TYPES.NFT_BID, label: "Place Bids" },
  token_bid: { type: NFT_TX_TYPES.NFT_BID, label: "Place Bid" },
  token_bids: { type: NFT_TX_TYPES.NFT_BID, label: "Place Bids" },
  cancel_collection_bid: { type: NFT_TX_TYPES.NFT_BID, label: "Cancel Bid" },
  cancel_token_bid: { type: NFT_TX_TYPES.NFT_BID, label: "Cancel Bid" },
  accept_collection_bid: { type: NFT_TX_TYPES.NFT_SALE, label: "Accept Bid" },
  accept_token_bid: { type: NFT_TX_TYPES.NFT_SALE, label: "Accept Bid" },
  unlist_and_accept_collection_bid: { type: NFT_TX_TYPES.NFT_SALE, label: "Accept Bid" },
  unlist_and_accept_token_bid: { type: NFT_TX_TYPES.NFT_SALE, label: "Accept Bid" },
};
