// Badge rule types (matches smart contract)
export const BADGE_RULES = {
  ALLOWLIST: 1,         // Admin-managed whitelist
  MIN_BALANCE: 2,       // Minimum token balance (on-chain verified)
  ATTESTATION: 3,       // Off-chain verified, admin attests
  TX_COUNT: 4,          // Minimum transaction count
  ACTIVE_DAYS: 5,       // Minimum days with activity
  PROTOCOL_COUNT: 6,    // Minimum DeFi protocols used
  DAPP_USAGE: 7,        // Specific dApp interaction
  HOLDING_PERIOD: 8,    // Hold tokens for duration
  NFT_HOLDER: 9,        // Must hold specific NFT
  COMPOSITE: 10,        // Multiple rules (AND logic)
  // Legacy aliases
  TRANSACTION_COUNT: 4,
  DAYS_ONCHAIN: 5,
};

// Badge status (matches smart contract)
export const BADGE_STATUS = {
  ACTIVE: 1,
  PAUSED: 2,
  DISCONTINUED: 3,
};
