import { findTrackedDappMatch } from "../config/dapps";
import { getTokenInfo } from "../config/tokens";


/**
 * Transaction History Engine v2
 * Production-grade classifier using real on-chain event schemas.
 */

// ─── TX Types ────────────────────────────────────────────────
export const TX_TYPES = {
  SWAP: "swap", SEND: "send", RECEIVED: "received",
  STAKE: "stake", UNSTAKE: "unstake",
  LEND: "lend", BORROW: "borrow", REPAY: "repay",
  DEPOSIT: "deposit", WITHDRAW: "withdraw",
  CLAIM: "claim", BRIDGE: "bridge",
  NFT_MINT: "nft_mint", NFT_TRANSFER: "nft_transfer",
  LIQUIDITY: "liquidity",
  YIELD: "yield",

  OTHER: "other",
};

// ─── Visual Config ───────────────────────────────────────────
export const TX_VISUALS = {
  [TX_TYPES.SWAP]: { label: "Swap", icon: "⇄", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)" },
  [TX_TYPES.SEND]: { label: "Send", icon: "↗", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  [TX_TYPES.RECEIVED]: { label: "Receive", icon: "↙", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  [TX_TYPES.STAKE]: { label: "Stake", icon: "🔒", color: "#3B82F6", bg: "rgba(59,130,246,0.1)" },
  [TX_TYPES.UNSTAKE]: { label: "Unstake", icon: "🔓", color: "#6366F1", bg: "rgba(99,102,241,0.1)" },
  [TX_TYPES.LEND]: { label: "Lend", icon: "🏦", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  [TX_TYPES.BORROW]: { label: "Borrow", icon: "💸", color: "#EC4899", bg: "rgba(236,72,153,0.1)" },
  [TX_TYPES.REPAY]: { label: "Repay", icon: "💰", color: "#14B8A6", bg: "rgba(20,184,166,0.1)" },
  [TX_TYPES.DEPOSIT]: { label: "Deposit", icon: "📥", color: "#06B6D4", bg: "rgba(6,182,212,0.1)" },
  [TX_TYPES.WITHDRAW]: { label: "Withdraw", icon: "📤", color: "#F97316", bg: "rgba(249,115,22,0.1)" },
  [TX_TYPES.CLAIM]: { label: "Claim", icon: "🎁", color: "#FACC15", bg: "rgba(250,204,21,0.1)" },
  [TX_TYPES.BRIDGE]: { label: "Bridge", icon: "🌉", color: "#64748B", bg: "rgba(100,116,139,0.1)" },
  [TX_TYPES.NFT_MINT]: { label: "NFT Mint", icon: "🎨", color: "#A855F7", bg: "rgba(168,85,247,0.1)" },
  [TX_TYPES.NFT_TRANSFER]: { label: "NFT Transfer", icon: "🖼️", color: "#EC4899", bg: "rgba(236,72,153,0.1)" },
  [TX_TYPES.LIQUIDITY]: { label: "Liquidity", icon: "💧", color: "#0EA5E9", bg: "rgba(14,165,233,0.1)" },
  [TX_TYPES.YIELD]: { label: "Yield", icon: "🌱", color: "#10B981", bg: "rgba(16,185,129,0.1)" },

  [TX_TYPES.OTHER]: { label: "Contract", icon: "⚙️", color: "#94A3B8", bg: "rgba(148,163,184,0.1)" },
};

// ─── Function Suffix → Type + Label (from real on-chain data) ─
const FUNC_MAP = {
  // Meridian DEX
  swap_exact_in_stable_entry: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  swap_exact_in_metastable_entry: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  swap_exact_in_weighted_entry: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  swap_exact_in_router_entry: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  new_position: { type: TX_TYPES.LIQUIDITY, label: "Add Liquidity" },
  add_liquidity_stable_entry: { type: TX_TYPES.LIQUIDITY, label: "Add Liquidity" },
  add_liquidity_weighted_entry: { type: TX_TYPES.LIQUIDITY, label: "Add Liquidity" },
  remove_liquidity_entry: { type: TX_TYPES.WITHDRAW, label: "Remove Liquidity" },
  // Route-X
  swap_entry: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  // Yuzu
  swap_exact_coin_for_fa_multi_hops: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  collect_multi_rewards: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  add_liquidity: { type: TX_TYPES.LIQUIDITY, label: "Add Liquidity" },
  remove_liquidity: { type: TX_TYPES.WITHDRAW, label: "Remove Liquidity" },
  collect_fee: { type: TX_TYPES.CLAIM, label: "Collect Fees" },
  // MovePosition
  lend_v2: { type: TX_TYPES.LEND, label: "Lend Assets" },
  lend_to_portfolio: { type: TX_TYPES.YIELD, label: "Auto-Compound" },
  borrow_v2: { type: TX_TYPES.BORROW, label: "Borrow Assets" },
  redeem_v2: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  redeem: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  repay_v2: { type: TX_TYPES.REPAY, label: "Repay Loan" },
  // Echelon
  supply: { type: TX_TYPES.LEND, label: "Supply Assets" },
  supply_fa: { type: TX_TYPES.LEND, label: "Supply Assets" },
  withdraw: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  withdraw_fa: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  claim_reward: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  claim_reward_fa: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  new_epoch: { type: TX_TYPES.OTHER, label: "Farming Admin" },
  new_epoch_fa: { type: TX_TYPES.OTHER, label: "Farming Admin" },
  new_pool: { type: TX_TYPES.OTHER, label: "Farming Admin" },
  new_reward: { type: TX_TYPES.OTHER, label: "Farming Admin" },
  new_reward_fa: { type: TX_TYPES.OTHER, label: "Farming Admin" },
  // Joule
  lend: { type: TX_TYPES.LEND, label: "Lend Assets" },
  lend_fa: { type: TX_TYPES.LEND, label: "Lend Assets" },
  borrow_fa: { type: TX_TYPES.BORROW, label: "Borrow Assets" },
  repay_fa: { type: TX_TYPES.REPAY, label: "Repay Loan" },
  claim_rewards: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  batch_claim_rewards: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  batch_claim_rewards_1: { type: TX_TYPES.CLAIM, label: "Claim Rewards" },
  // Canopy
  deposit_fa_with_coin_type: { type: TX_TYPES.STAKE, label: "Deposit to Vault" },
  deposit_fa: { type: TX_TYPES.DEPOSIT, label: "Deposit Assets" },
  deposit_coin: { type: TX_TYPES.DEPOSIT, label: "Deposit Assets" },
  withdraw_coin: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  withdraw_token: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  stake: { type: TX_TYPES.STAKE, label: "Stake Assets" },
  stake_token: { type: TX_TYPES.STAKE, label: "Stake Assets" },
  stake_and_subscribe: { type: TX_TYPES.STAKE, label: "Stake & Subscribe" },
  stake_and_subscribe_fa: { type: TX_TYPES.STAKE, label: "Stake & Subscribe" },
  stake_and_subscribe_token: { type: TX_TYPES.STAKE, label: "Stake & Subscribe" },
  unsubscribe_and_withdraw: { type: TX_TYPES.UNSTAKE, label: "Unstake Assets" },
  unsubscribe_and_withdraw_fa: { type: TX_TYPES.UNSTAKE, label: "Unstake Assets" },
  unsubscribe_and_withdraw_token: { type: TX_TYPES.UNSTAKE, label: "Unstake Assets" },
  emergency_withdraw: { type: TX_TYPES.UNSTAKE, label: "Emergency Unstake" },
  subscribe: { type: TX_TYPES.OTHER, label: "Subscribe Pool" },
  unsubscribe: { type: TX_TYPES.OTHER, label: "Unsubscribe Pool" },
  // LayerBank
  redeem_fa: { type: TX_TYPES.WITHDRAW, label: "Withdraw Assets" },
  // CapyGo
  sell_miner: { type: TX_TYPES.OTHER, label: "Sell Miner" },
  // Tradeport NFT

  transfer_tokens_v2: { type: TX_TYPES.NFT_TRANSFER, label: "Transfer NFT" },
  mosaic_swap_with_fee: { type: TX_TYPES.SWAP, label: "Swap Assets" },
  // BRKT Prediction
  sell: { type: TX_TYPES.SWAP, label: "Sell Shares" },
  // Moversmap
  mint_memory: { type: TX_TYPES.NFT_MINT, label: "Mint Memory" },
  send_gift: { type: TX_TYPES.SEND, label: "Send Gift" },
  claim_treasure: { type: TX_TYPES.CLAIM, label: "Claim Treasure" },
  join_guild: { type: TX_TYPES.OTHER, label: "Join Guild" },
  record_move: { type: TX_TYPES.OTHER, label: "Record Move" },
  register_pin: { type: TX_TYPES.OTHER, label: "Register Pin" },
  // Common Lending
  borrow: { type: TX_TYPES.BORROW, label: "Borrow Assets" },
  repay: { type: TX_TYPES.REPAY, label: "Repay Loan" },
  // Movement Chain
  transfer: { type: TX_TYPES.SEND, label: "Transfer Assets" },
  transfer_coins: { type: TX_TYPES.SEND, label: "Transfer Coins" },
  batch_transfer_coins: { type: TX_TYPES.SEND, label: "Batch Transfer" },
  // Staking
  add_stake: { type: TX_TYPES.STAKE, label: "Add Stake" },
  add_stake_with_coin: { type: TX_TYPES.STAKE, label: "Add Stake" },
  reactivate_stake: { type: TX_TYPES.STAKE, label: "Reactivate Stake" },
  reactivate_stake_with_coin: { type: TX_TYPES.STAKE, label: "Reactivate Stake" },
  stake_and_mint: { type: TX_TYPES.STAKE, label: "Stake & Mint" },
  unlock: { type: TX_TYPES.UNSTAKE, label: "Unlock Stake" },
  unlock_stake: { type: TX_TYPES.UNSTAKE, label: "Unlock Stake" },
  unlock_with_coin: { type: TX_TYPES.UNSTAKE, label: "Unlock Stake" },
  withdraw_pending_inactive: { type: TX_TYPES.UNSTAKE, label: "Withdraw Stake" },
  withdraw_stake: { type: TX_TYPES.UNSTAKE, label: "Withdraw Stake" },
  withdraw_with_coin: { type: TX_TYPES.UNSTAKE, label: "Withdraw Stake" },
  request_commission: { type: TX_TYPES.CLAIM, label: "Request Commission" },
  distribute: { type: TX_TYPES.CLAIM, label: "Distribute Rewards" },
  update_commission: { type: TX_TYPES.OTHER, label: "Update Commission" },
  set_beneficiary_for_operator: { type: TX_TYPES.OTHER, label: "Set Beneficiary" },
  // MMEX
  open_position: { type: TX_TYPES.OTHER, label: "Open Position" },
  close_position: { type: TX_TYPES.OTHER, label: "Close Position" },
  // ClobX
  place_order: { type: TX_TYPES.SWAP, label: "Place Order" },
  cancel_order: { type: TX_TYPES.OTHER, label: "Cancel Order" },
  // Pyth
  update_price_feeds_with_funder: { type: TX_TYPES.OTHER, label: "Update Oracle" },
  // Move Match (fantasy_epl)
  register_team: { type: TX_TYPES.DEPOSIT, label: "Register Team" },
  buy_title: { type: TX_TYPES.SWAP, label: "Buy Title" },
  reroll_title: { type: TX_TYPES.SWAP, label: "Reroll Title" },
  buy_guild: { type: TX_TYPES.SWAP, label: "Buy Guild" },
  reroll_guild: { type: TX_TYPES.SWAP, label: "Reroll Guild" },
  claim_prize: { type: TX_TYPES.CLAIM, label: "Claim Winnings" },
  admin_sponsor_prize_pool: { type: TX_TYPES.LEND, label: "Sponsor Prize Pool" },
  create_gameweek: { type: TX_TYPES.OTHER, label: "Create Gameweek" },
  close_gameweek: { type: TX_TYPES.OTHER, label: "Close Gameweek" },
  reopen_gameweek: { type: TX_TYPES.OTHER, label: "Reopen Gameweek" },
  submit_player_stats: { type: TX_TYPES.OTHER, label: "Submit Player Stats" },
  calculate_results: { type: TX_TYPES.OTHER, label: "Calculate Results" },
  calculate_results_v2: { type: TX_TYPES.OTHER, label: "Calculate Results" },
  calculate_results_v3: { type: TX_TYPES.OTHER, label: "Calculate Results" },
  // System
  rotate_authentication_key: { type: TX_TYPES.OTHER, label: "Rotate Auth Key" },
  publish_package_txn: { type: TX_TYPES.OTHER, label: "Publish Package" },
};

// ─── Event Schema Registry (from real explorer data) ─────────
const EVENT_SCHEMAS = {
  // Meridian
  "pool::SwapEvent": { amount_in: "amount_in", amount_out: "amount_out", token_in: "metadata_0", token_out: "metadata_1" },
  "pool::NewPositionEvent": { type: TX_TYPES.LIQUIDITY },
  "pool::IncreaseLiquidityEvent": { amount_0: "amount_0", amount_1: "amount_1", type: TX_TYPES.LIQUIDITY },
  // Yuzu
  "liquidity_pool::SwapEvent": { amount_in: "amount_in", amount_out: "amount_out" },
  "liquidity_pool::CollectRewardEvent": { amount: "amount", type: TX_TYPES.CLAIM },
  "liquidity_pool::AddLiquidityEvent": { amount_0: "amount_0", amount_1: "amount_1", type: TX_TYPES.LIQUIDITY },
  "liquidity_pool::CollectProtocolFee": { amount_0: "amount_0", amount_1: "amount_1", type: TX_TYPES.CLAIM },
  // Mosaic
  "router::SwapEvent": { amount_in: "input_amount", amount_out: "output_amount", token_in: "input_asset", token_out: "output_asset", type: TX_TYPES.SWAP },
  "router::SwapStepEvent": { amount_in: "input_amount", amount_out: "output_amount", token_in: "input_asset", token_out: "output_asset", type: TX_TYPES.SWAP },
  // Echelon
  "lending::SupplyEvent": { amount: "amount", type: TX_TYPES.LEND },
  "lending::WithdrawEvent": { amount: "amount", type: TX_TYPES.WITHDRAW },
  "farming::ClaimEvent": { amount: "amount", type: TX_TYPES.CLAIM },
  "farming::StakeEvent": { amount: "amount", type: TX_TYPES.STAKE },
  "farming::UnstakeEvent": { amount: "amount", type: TX_TYPES.UNSTAKE },
  // Joule
  "pool::LendEvent": { amount: "amount", type: TX_TYPES.LEND },
  // LayerBank
  "supply_logic::Supply": { amount: "amount", type: TX_TYPES.LEND },
  "token_base::Mint": { amount: "value", type: TX_TYPES.LEND },
  // Canopy
  "vault::Deposit": { amount: "amount", type: TX_TYPES.DEPOSIT },
  "vault::BaseStrategySharesDeposit": { amount: "amount", type: TX_TYPES.DEPOSIT },
  // MovePosition
  "lend::LendEvent": { amount: "amount", type: TX_TYPES.LEND },
  "lend::RedeemEvent": { amount: "amount", type: TX_TYPES.WITHDRAW },
  "lend::BorrowEvent": { amount: "amount", type: TX_TYPES.BORROW },
  "lend::RepayEvent": { amount: "amount", type: TX_TYPES.REPAY },
  "borrow::BorrowEvent": { amount: "amount", type: TX_TYPES.BORROW },
  // Tradeport NFT
  "listings_v2::BuyEvent": { amount: "price", type: TX_TYPES.SWAP },
  "listings_v2::InsertListingEvent": { type: TX_TYPES.OTHER },
  "listings_v2::DeleteListingEvent": { type: TX_TYPES.OTHER },
  "biddings_v2::InsertCollectionBidEvent": { amount: "price", type: TX_TYPES.OTHER },
  "biddings_v2::InsertTokenBidEvent": { amount: "price", type: TX_TYPES.OTHER },
  "biddings_v2::DeleteCollectionBidEvent": { type: TX_TYPES.OTHER },
  "biddings_v2::DeleteTokenBidEvent": { type: TX_TYPES.OTHER },
  "biddings_v2::AcceptCollectionBidEvent": { amount: "price", type: TX_TYPES.SWAP },
  "biddings_v2::AcceptTokenBidEvent": { amount: "price", type: TX_TYPES.SWAP },
  // Moversmap
  "memory_nft::MemoryMinted": { type: TX_TYPES.NFT_MINT },
  "gift_ledger::GiftSent": { amount: "amount", type: TX_TYPES.SEND },
  "treasure_claim::TreasureClaimed": { amount: "amount", type: TX_TYPES.CLAIM },
  "guild_ledger::GuildJoined": { type: TX_TYPES.OTHER },
  "conquest_ledger::WarriorMoved": { type: TX_TYPES.OTHER },
  "pin_registry::PinRegistered": { type: TX_TYPES.OTHER },
  "mining::MinerSold": { amount: "price", type: TX_TYPES.OTHER },
  // Move Match (fantasy_epl)
  "fantasy_epl::TitleAssigned": { type: TX_TYPES.SWAP },
  "fantasy_epl::GuildAssigned": { type: TX_TYPES.SWAP },
  "fantasy_epl::GameweekClosed": { type: TX_TYPES.OTHER },
  "fantasy_epl::PrizeClaimed": { amount: "amount", type: TX_TYPES.CLAIM },
  "fantasy_epl::PrizePoolSponsored": { amount: "amount", type: TX_TYPES.LEND },
};

// ─── Keyword Fallback ────────────────────────────────────────
const KEYWORDS = {
  [TX_TYPES.SWAP]: ["swap", "exact_input", "exact_output", "exchange", "router", "mosaic", "buy_title", "buy_guild", "reroll_title", "reroll_guild"],
  [TX_TYPES.STAKE]: ["stake", "delegate", "liquid_staking", "subscribe"],
  [TX_TYPES.UNSTAKE]: ["unstake", "undelegate", "withdraw_stake", "request_withdraw", "withdraw_pending", "redeem", "unsubscribe"],
  [TX_TYPES.LEND]: ["lend", "supply", "deposit_v2", "supply_fa", "lend_fa"],
  [TX_TYPES.BORROW]: ["borrow", "flash_loan", "borrow_v2", "borrow_fa"],
  [TX_TYPES.REPAY]: ["repay", "repay_v2", "repay_fa"],
  [TX_TYPES.WITHDRAW]: ["withdraw", "redeem", "remove_liquidity", "withdraw_fa", "withdraw_coin", "withdraw_token", "redeem_fa"],
  [TX_TYPES.SEND]: ["transfer", "send", "pay", "send_gift"],
  [TX_TYPES.RECEIVED]: ["receive", "deposit_coins"],
  [TX_TYPES.CLAIM]: ["claim", "harvest", "collect_reward", "claim_rewards", "collect_fee", "collect_multi_rewards", "claim_reward_fa", "claim_prize", "claim_treasure"],
  [TX_TYPES.YIELD]: ["yield", "compound", "auto_compound"],
  [TX_TYPES.BRIDGE]: ["bridge", "outbound", "inbound", "teleport", "wormhole", "layerzero"],
  [TX_TYPES.NFT_MINT]: ["mint_nft", "create_token", "create_collection", "mint_token", "mint_memory"],
};

// ─── Helpers ─────────────────────────────────────────────────
const getFuncSuffix = (fn) => {
  const lower = String(fn || "").toLowerCase();
  return lower.includes("::") ? lower.split("::").pop() : lower;
};

const resolveSymbol = (assetType: string, activity?: any) => {
  const sym = activity?.metadata?.symbol || activity?.symbol;
  if (sym) return String(sym).toUpperCase();

  const info = getTokenInfo(assetType);
  if (info?.symbol) return String(info.symbol).toUpperCase();

  if (assetType?.includes("::")) {
    // Handle generic types like 0x1::coin::CoinStore<0x...::MOVE>
    // Extract the innermost part before any < or >
    const parts = assetType.split("::");
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/([^<]+)/);
    let name = match ? match[1] : lastPart;

    // If it's a generic like Coin<...>, try to get the part inside <>
    if (assetType.includes("<") && assetType.includes(">")) {
      const innerMatch = assetType.match(/<([^>]+)>/);
      if (innerMatch) {
        const innerType = innerMatch[1];
        const innerSymbol = resolveSymbol(innerType);
        if (innerSymbol) return innerSymbol;
      }
    }

    return name.toUpperCase();
  }
  return null;
};

const resolveDecimals = (assetType: string, activity?: any) => {
  if (activity?.metadata?.decimals != null) return Number(activity.metadata.decimals);
  const info = getTokenInfo(assetType);
  if (info?.decimals != null) return info.decimals;
  return 8;
};

// ─── Activity Normalizer ─────────────────────────────────────
const normalizeActivity = (activity, userAddr) => {
  if (!activity) return null;
  const type = String(activity.type || activity.event_type || "").toLowerCase();
  const assetType = String(activity.asset_type || activity.coin_type || activity.coinType || activity.metadata?.asset_type || "").trim();
  const rawAmount = activity.amount ?? activity.data?.amount ?? activity.data?.value ?? 0;

  const isGas = type.includes("gas") || type.includes("fee");
  const owner = String(activity.owner_address || activity.owner || "").toLowerCase();
  const isUserOwner = userAddr && owner === userAddr.toLowerCase();

  let direction = null;
  if (isGas) {
    direction = "out";
  } else if (type.includes("withdraw") || type.includes("burn")) {
    direction = isUserOwner ? "out" : null;
  } else if (type.includes("deposit") || type.includes("mint")) {
    direction = isUserOwner ? "in" : null;
  } else if (type.includes("transfer")) {
    if (isUserOwner) {
      // On Aptos, a transfer activity for the user usually means they are on one side.
      // Usually the indexer emits two activities for a transfer.
      // We'll trust the type-based direction if available, otherwise fallback.
      direction = type.includes("withdraw") ? "out" : "in";
    }
  }

  const decimals = resolveDecimals(assetType, activity);
  const amount = Math.abs(Number(rawAmount)) / Math.pow(10, decimals);
  const symbol = resolveSymbol(assetType, activity);

  if (!symbol && amount === 0) return null;
  return { direction, amount, symbol, assetType, type, decimals, isGas };
};

// ─── Event Decoder ───────────────────────────────────────────
const decodeEvents = (events = []) => {
  const decoded = { type: null, amount_in: null, amount_out: null, token_in: null, token_out: null, amount: null, amounts: [] };

  for (const evt of events) {
    const evtType = String(evt.type || "").toLowerCase();
    for (const [schemaKey, schemaRaw] of Object.entries(EVENT_SCHEMAS)) {
      const schema = schemaRaw as any;
      if (evtType.includes(schemaKey.toLowerCase())) {
        const data = evt.data || {};
        if (schema.type && !decoded.type) decoded.type = schema.type;
        if (schema.amount_in && data[schema.amount_in]) decoded.amount_in = Number(data[schema.amount_in]);
        if (schema.amount_out && data[schema.amount_out]) decoded.amount_out = Number(data[schema.amount_out]);
        if (schema.token_in && data[schema.token_in]) decoded.token_in = data[schema.token_in];
        if (schema.token_out && data[schema.token_out]) decoded.token_out = data[schema.token_out];
        if (schema.amount && data[schema.amount]) {
          decoded.amount = Number(data[schema.amount]);
          decoded.amounts.push(Number(data[schema.amount]));
        }
        break;
      }
    }
  }
  return decoded;
};

// ─── Classifier ──────────────────────────────────────────────
export const classifyTransaction = (functionName, activities, dapp, eventData, isInitiator = true) => {
  const suffix = getFuncSuffix(functionName);
  let type = null;

  // 1. Exact function match (highest priority)
  if (FUNC_MAP[suffix]) type = FUNC_MAP[suffix].type;

  // 2. Event-driven type override
  if (!type && eventData?.type) type = eventData.type;

  // 3. NFT detection
  if (!type) {
    const isNft = activities.some(a => a.type?.includes("token_v2") || a.type?.includes("collection"));
    if (isNft) {
      const lower = String(functionName || "").toLowerCase();
      if (lower.includes("mint")) type = TX_TYPES.NFT_MINT;
      else if (lower.includes("transfer")) type = TX_TYPES.NFT_TRANSFER;
    }
  }

  // 4. Keyword fallback
  if (!type) {
    const lower = String(functionName || "").toLowerCase();
    for (const [kwType, kws] of Object.entries(KEYWORDS)) {
      if (kws.some(k => lower.includes(k))) {
        type = kwType;
        break;
      }
    }
  }

  // 5. Activity-direction fallback
  if (!type) {
    // Ignore gas fees for direction-based classification
    const incoming = activities.filter(a => a.direction === "in" && a.amount > 0 && !a.isGas);
    const outgoing = activities.filter(a => a.direction === "out" && a.amount > 0 && !a.isGas);
    if (incoming.length > 0 && outgoing.length > 0) type = TX_TYPES.SWAP;
    else if (incoming.length > 0) type = TX_TYPES.RECEIVED;
    else if (outgoing.length > 0) type = TX_TYPES.SEND;
  }

  type = type || TX_TYPES.OTHER;

  // Convert SEND to RECEIVED if the user is not the initiator
  if (type === TX_TYPES.SEND && !isInitiator) {
    return TX_TYPES.RECEIVED;
  }

  return type;
};

// ─── Metadata Extractor ──────────────────────────────────────
export const extractMetadata = (activities: any[], eventData: any, dapp?: any, functionName = "", type = "", suffix = "", allRawActivities: any[] = []) => {
  const incoming = activities.filter(a => a.direction === "in" && a.amount > 0 && !a.isGas);
  const outgoing = activities.filter(a => a.direction === "out" && a.amount > 0);

  // For multi-hop swaps, identify intermediate tokens (tokens that are both IN and OUT)
  // IMPORTANT: Ignore gas fees for intermediate detection to avoid MOVE being excluded from swaps
  const inAssetTypes = new Set(incoming.map(a => a.assetType).filter(Boolean));
  const outAssetTypes = new Set(outgoing.filter(a => !a.isGas).map(a => a.assetType).filter(Boolean));
  const intermediates = new Set([...inAssetTypes].filter(x => outAssetTypes.has(x)));

  // Prefer tokens that are NOT intermediates and NOT gas fees
  const finalIncoming = incoming.filter(a => !intermediates.has(a.assetType));
  const finalOutgoing = outgoing.filter(a => !intermediates.has(a.assetType) && !a.isGas);

  // Sorting helper: prefer tokens with symbols that aren't MOVE if it's a swap-like flow
  const sortActivities = (list) => [...list].sort((a, b) => {
    // If one is MOVE and other isn't, and we have multiple options, prefer the non-MOVE one for swaps
    if (list.length > 1) {
      const aIsMove = a.symbol === 'MOVE';
      const bIsMove = b.symbol === 'MOVE';
      if (aIsMove && !bIsMove) return 1;
      if (!aIsMove && bIsMove) return -1;
    }
    return b.amount - a.amount;
  });

  const nonGasIncoming = incoming.filter(a => !a.isGas);
  const nonGasOutgoing = outgoing.filter(a => !a.isGas);

  const primaryIn = sortActivities(finalIncoming.length > 0 ? finalIncoming : nonGasIncoming)[0];
  const primaryOut = sortActivities(finalOutgoing.length > 0 ? finalOutgoing : nonGasOutgoing)[0];

  let tokenIn = primaryOut?.symbol;
  if (!tokenIn && eventData?.token_in) tokenIn = resolveSymbol(eventData.token_in);

  let tokenOut = primaryIn?.symbol;
  if (!tokenOut && eventData?.token_out) tokenOut = resolveSymbol(eventData.token_out);

  // Decimal resolution for eventData
  const getEventAmount = (val, assetType?: string) => {
    if (!val) return null;
    const dec = resolveDecimals(assetType || "0x1::aptos_coin::AptosCoin");
    return val / Math.pow(10, dec);
  };

  let amountIn = primaryOut?.amount || getEventAmount(eventData?.amount_in, eventData?.token_in);
  let amountOut = primaryIn?.amount || getEventAmount(eventData?.amount_out, eventData?.token_out);

  // Fallback for single-sided protocol interactions missing direct user flows (e.g. MovePosition auto-compounding)
  if (!primaryIn && !primaryOut && allRawActivities.length > 0) {
    const fallbackAct = allRawActivities.find(a => Number(a.amount || a.data?.amount || a.data?.value || 0) > 0);
    if (fallbackAct) {
      const decStr = fallbackAct.metadata?.decimals || fallbackAct.data?.metadata?.decimals || fallbackAct.decimals;
      const dec = decStr != null ? Number(decStr) : resolveDecimals(fallbackAct.asset_type || fallbackAct.assetType || fallbackAct.coin_type);
      const amountRaw = fallbackAct.amount || fallbackAct.data?.amount || fallbackAct.data?.value || 0;
      const fallbackAmount = Number(amountRaw) / Math.pow(10, dec);
      const fallbackSymbol = resolveSymbol(fallbackAct.asset_type || fallbackAct.assetType || fallbackAct.coin_type, fallbackAct);

      if (!amountOut && fallbackAmount > 0) {
        amountOut = fallbackAmount;
        tokenOut = fallbackSymbol;
      }
    }
  }

  // High-fidelity overrides for Tradeport NFT Buy/Accept Bid transactions
  const isTradeport = dapp?.key === "tradeport" || functionName.includes("biddings_v2") || functionName.includes("listings_v2");
  if (isTradeport) {
    const isBuy = suffix.includes("buy");
    const isAccept = suffix.includes("accept");

    // Sum all MOVE deposits globally to get the exact gross sale/bid price
    const moveDeposits = allRawActivities.filter(ra => {
      const isDeposit = String(ra.type || ra.activity_type || "").toLowerCase().includes("deposit");
      const assetType = String(ra.asset_type || ra.coin_type || "").toLowerCase();
      const isMove = assetType.includes("aptos_coin") || assetType === "0x1" || assetType === "0x000000000000000000000000000000000000000000000000000000000000000a";
      return isDeposit && isMove;
    });

    const grossPrice = moveDeposits.reduce((sum, ra) => {
      const decStr = ra.metadata?.decimals || ra.data?.metadata?.decimals;
      const dec = decStr != null ? Number(decStr) : 8;
      const amountRaw = ra.amount || ra.data?.amount || ra.data?.value || 0;
      const amount = Number(amountRaw) / Math.pow(10, dec);
      if (amount < 0.005) return sum;
      return sum + amount;
    }, 0);

    if (isBuy) {
      tokenIn = "MOVE";
      tokenOut = "NFT";
      amountIn = grossPrice || amountIn || amountOut;
      amountOut = 1;
    } else if (isAccept) {
      tokenIn = "NFT";
      tokenOut = "MOVE";
      amountIn = 1;
      amountOut = grossPrice || amountOut || amountIn;
    } else if (suffix.includes("bid")) {
      // For token_bid / collection_bid, the MOVE deposit is the bid escrow amount
      amountIn = grossPrice || amountIn || amountOut;
      tokenIn = "MOVE";
      amountOut = null;
      tokenOut = null;
    }
  }

  return {
    token_in: tokenIn || null,
    token_out: tokenOut || null,
    amount_in: amountIn || null,
    amount_out: amountOut || null,
  };
};

// ─── Main Entry Point ────────────────────────────────────────
export const markTransaction = (tx, walletAddress, dynamicEntities = []) => {
  const userAddr = String(walletAddress || "").toLowerCase();
  const functionName = tx.functionName || tx.payload?.function || tx.entry_function_id_str || "";
  const suffix = getFuncSuffix(functionName);

  // Normalize activities
  const rawActivities = tx.fungibleActivities || tx.fungible_asset_activities || [];
  const events = tx.events || [];
  const allRaw = [
    ...rawActivities,
    ...events.map(e => ({
      type: e.type,
      amount: e.data?.amount || e.data?.value,
      asset_type: e.data?.coin_type || e.data?.asset_type || e.data?.metadata?.asset_type,
      owner_address: e.account_address || e.guid?.account_address,
      metadata: e.data?.metadata || null, data: e.data,
    })),
  ];

  // De-duplicate activities by owner and amount to prevent double-counting due to coin-to-fungible-asset mirroring
  const seenRaw = new Set<string>();
  const deDuplicatedRaw = allRaw.filter(ra => {
    const owner = String(ra.owner_address || ra.owner || '').toLowerCase();
    const amt = String(ra.amount || 0);
    if (!owner) return true; // Keep items without owners
    const key = `${owner}:${amt}`;
    if (seenRaw.has(key)) return false;
    seenRaw.add(key);
    return true;
  });

  const activities = deDuplicatedRaw.map(ra => normalizeActivity(ra, userAddr)).filter(Boolean);

  // Decode events for rich data
  const eventData = decodeEvents(events);

  // dApp matching
  const dapp = findTrackedDappMatch({
    textParts: [functionName, tx.payload?.function],
    addresses: [
      tx.sender,
      tx.payload?.function?.split("::")[0],
      tx.to_address,
      // Extract any other addresses from function arguments if possible
      ...(Array.isArray(tx.payload?.arguments) ? tx.payload.arguments.filter(a => typeof a === 'string' && a.startsWith('0x')) : [])
    ],
    dynamicEntities,
  });

  const senderAddr = String(tx.sender || tx.user_transaction?.sender || "").toLowerCase();
  const isInitiator = !userAddr || userAddr === senderAddr;

  const type = classifyTransaction(functionName, activities, dapp, eventData, isInitiator);
  const metadata = extractMetadata(activities, eventData, dapp, functionName, type, suffix, deDuplicatedRaw);
  const visuals = TX_VISUALS[type] || TX_VISUALS[TX_TYPES.OTHER];
  const label = FUNC_MAP[suffix]?.label || visuals.label;

  let dappName = dapp?.name;
  if (!dappName) {
    dappName = (type === TX_TYPES.SEND || type === TX_TYPES.RECEIVED) ? "Wallet" : "Unknown Contract";
  }

  return {
    ...tx,
    tx_type: type,
    tx_label: label,
    tx_icon: visuals.icon,
    tx_color: visuals.color,
    tx_bg: visuals.bg,
    dapp_key: dapp?.key || null,
    dapp_name: dappName,
    dapp_logo: dapp?.logo || null,
    dapp_website: dapp?.website || null,
    ...metadata,
    status: (tx.success === false || tx.status === "failed") ? "failed" : "success",
  };
};
