import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import { KNOWN_EXCHANGES } from '../config/whitelists.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { reconstructHistoricalBalances } from './portfolioService.ts';
import {
  TRADEPORT_SUFFIX_MAP,
  processTradeportAssets,
  generateTradeportDescription
} from './nft/tradeportDetector.ts';

const MOVEMENT_INDEXER_URL = CONFIG.MOVEMENT.INDEXER_URL;

// GraphQL query for deep transaction history
const GET_USER_TRANSACTIONS_PAGINATED = `
  query WalletTransactions($address: String!, $limit: Int!, $lt_version: bigint) {
    account_transactions(
      where: { 
        account_address: { _eq: $address },
        transaction_version: { _lt: $lt_version }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
      user_transaction {
        sender
        timestamp
        entry_function_id_str
      }
      fungible_asset_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        asset_type
        type
        is_transaction_success
        entry_function_id_str
        metadata {
          symbol
          decimals
        }
      }
      coin_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        coin_type
        activity_type
        is_transaction_success
        entry_function_id_str
      }
    }
  }
`;

// GraphQL query for forward incremental sync (new transactions)
const GET_USER_TRANSACTIONS_FORWARD_PAGINATED = `
  query WalletTransactionsForward($address: String!, $limit: Int!, $gt_version: bigint) {
    account_transactions(
      where: { 
        account_address: { _eq: $address },
        transaction_version: { _gt: $gt_version }
      }
      order_by: { transaction_version: asc }
      limit: $limit
    ) {
      transaction_version
      user_transaction {
        sender
        timestamp
        entry_function_id_str
      }
      fungible_asset_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        asset_type
        type
        is_transaction_success
        entry_function_id_str
        metadata {
          symbol
          decimals
        }
      }
      coin_activities {
        transaction_version
        transaction_timestamp
        owner_address
        amount
        coin_type
        activity_type
        is_transaction_success
        entry_function_id_str
      }
    }
  }
`;


let cachedLabels: any[] | null = null;
let lastLabelsFetch = 0;
const LABELS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

/**
 * Pagination helper to fetch all address labels from Supabase, bypassing the 1000 records limit
 */
async function fetchAllAddressLabels(supabase: SupabaseClient): Promise<any[]> {
  const now = Date.now();
  if (cachedLabels && (now - lastLabelsFetch < LABELS_CACHE_TTL)) {
    return cachedLabels;
  }

  let allLabels: any[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('address_labels')
      .select('*, tracked_entities(name, category)')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('[fetchAllAddressLabels] Error:', error);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allLabels.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  cachedLabels = allLabels;
  lastLabelsFetch = now;
  return allLabels;
}

/**
 * Deep classifier and humanizer for analytics
 * Mirrors the "fineist" frontend historyEngine.ts for server-side consistency
 */
function enrichTransaction(
  tx: any, 
  walletAddress: string, 
  labelsMap: Map<string, any> = new Map(),
  entitiesList: any[] = []
) {
  const userAddr = normalizeAddress(walletAddress);
  const ut = tx.user_transaction || {};
  const functionId = ut.entry_function_id_str || '';
  
  // 1. Internal Constants & Mapping (Mirrored from frontend historyEngine.ts)
  const TX_TYPES = {
    SWAP: "SWAP", SEND: "SEND", RECEIVE: "RECEIVE",
    STAKE: "STAKE", UNSTAKE: "UNSTAKE",
    LEND: "LEND", BORROW: "BORROW", REPAY: "REPAY",
    DEPOSIT: "DEPOSIT", WITHDRAW: "WITHDRAW",
    CLAIM: "CLAIM", BRIDGE: "BRIDGE",
    NFT_MINT: "NFT_MINT", NFT_TRANSFER: "NFT_TRANSFER",
    LIQUIDITY: "LIQUIDITY",
    NFT_SALE: "NFT_SALE",
    NFT_BUY: "NFT_BUY",
    NFT_LIST: "NFT_LIST",
    NFT_BID: "NFT_BID",
    OTHER: "OTHER",
  };

  const EVENT_SCHEMAS: Record<string, any> = {
    "pool::SwapEvent": { amount_in: "amount_in", amount_out: "amount_out", token_in: "metadata_0", token_out: "metadata_1", type: TX_TYPES.SWAP },
    "liquidity_pool::SwapEvent": { amount_in: "amount_in", amount_out: "amount_out", type: TX_TYPES.SWAP },
    "router::SwapEvent": { amount_in: "input_amount", amount_out: "output_amount", token_in: "input_asset", token_out: "output_asset", type: TX_TYPES.SWAP },
    "router::SwapStepEvent": { amount_in: "input_amount", amount_out: "output_amount", token_in: "input_asset", token_out: "output_asset", type: TX_TYPES.SWAP },
    "lending::SupplyEvent": { amount: "amount", type: TX_TYPES.LEND },
    "lending::WithdrawEvent": { amount: "amount", type: TX_TYPES.WITHDRAW },
    "pool::LendEvent": { amount: "amount", type: TX_TYPES.LEND },
    "supply_logic::Supply": { amount: "amount", type: TX_TYPES.LEND },
    "vault::Deposit": { amount: "amount", type: TX_TYPES.DEPOSIT },
    "lend::LendEvent": { amount: "amount", type: TX_TYPES.LEND },
    "lend::RedeemEvent": { amount: "amount", type: TX_TYPES.WITHDRAW },
    "lend::BorrowEvent": { amount: "amount", type: TX_TYPES.BORROW },
    "lend::RepayEvent": { amount: "amount", type: TX_TYPES.REPAY },
    "listings_v2::BuyEvent": { amount: "price", type: TX_TYPES.NFT_BUY },
    "listings_v2::InsertListingEvent": { type: TX_TYPES.NFT_LIST },
    "listings_v2::DeleteListingEvent": { type: TX_TYPES.NFT_LIST },
    "biddings_v2::InsertCollectionBidEvent": { amount: "price", type: TX_TYPES.NFT_BID },
    "biddings_v2::InsertTokenBidEvent": { amount: "price", type: TX_TYPES.NFT_BID },
    "biddings_v2::DeleteCollectionBidEvent": { type: TX_TYPES.NFT_BID },
    "biddings_v2::DeleteTokenBidEvent": { type: TX_TYPES.NFT_BID },
    "biddings_v2::AcceptCollectionBidEvent": { amount: "price", type: TX_TYPES.NFT_SALE },
    "biddings_v2::AcceptTokenBidEvent": { amount: "price", type: TX_TYPES.NFT_SALE },
    // Move Match (fantasy_epl)
    "fantasy_epl::TitleAssigned": { type: TX_TYPES.SWAP },
    "fantasy_epl::GuildAssigned": { type: TX_TYPES.SWAP },
    "fantasy_epl::GameweekClosed": { type: TX_TYPES.OTHER },
    "fantasy_epl::PrizeClaimed": { amount: "amount", type: TX_TYPES.CLAIM },
    "fantasy_epl::PrizePoolSponsored": { amount: "amount", type: TX_TYPES.LEND },
  };

  const FUNC_MAP: Record<string, any> = {
    swap: TX_TYPES.SWAP, swap_entry: TX_TYPES.SWAP, mosaic_swap_with_fee: TX_TYPES.SWAP,
    swap_exact_in_stable_entry: TX_TYPES.SWAP, swap_exact_in_metastable_entry: TX_TYPES.SWAP,
    swap_exact_in_weighted_entry: TX_TYPES.SWAP, swap_exact_in_router_entry: TX_TYPES.SWAP,
    swap_exact_coin_for_fa_multi_hops: TX_TYPES.SWAP,
    supply: TX_TYPES.LEND, lend_v2: TX_TYPES.LEND, lend: TX_TYPES.LEND,
    stake: TX_TYPES.STAKE, add_stake: TX_TYPES.STAKE, reactivate_stake: TX_TYPES.STAKE, stake_and_mint: TX_TYPES.STAKE,
    deposit_fa_with_coin_type: TX_TYPES.STAKE,
    deposit: TX_TYPES.DEPOSIT, deposit_fa: TX_TYPES.DEPOSIT, deposit_coin: TX_TYPES.DEPOSIT,
    borrow: TX_TYPES.BORROW, borrow_v2: TX_TYPES.BORROW,
    repay: TX_TYPES.REPAY, repay_v2: TX_TYPES.REPAY,
    claim: TX_TYPES.CLAIM, harvest: TX_TYPES.CLAIM, claim_reward: TX_TYPES.CLAIM, collect_reward: TX_TYPES.CLAIM,
    withdraw: TX_TYPES.WITHDRAW, redeem: TX_TYPES.WITHDRAW, redeem_v2: TX_TYPES.WITHDRAW,
    unstake: TX_TYPES.UNSTAKE, unlock: TX_TYPES.UNSTAKE, withdraw_stake: TX_TYPES.UNSTAKE,
    transfer: TX_TYPES.SEND, transfer_coins: TX_TYPES.SEND, batch_transfer_coins: TX_TYPES.SEND,
    // Tradeport NFT
    ...TRADEPORT_SUFFIX_MAP,
    // Move Match (fantasy_epl)
    register_team: TX_TYPES.DEPOSIT,
    buy_title: TX_TYPES.SWAP,
    reroll_title: TX_TYPES.SWAP,
    buy_guild: TX_TYPES.SWAP,
    reroll_guild: TX_TYPES.SWAP,
    claim_prize: TX_TYPES.CLAIM,
    admin_sponsor_prize_pool: TX_TYPES.LEND,
  };

  const STATIC_PROTOCOLS = [
    { name: 'Mosaic', addresses: ['0x03f739', '0x26a95d', '0xede23e', '0x3f7399'], keywords: ['mosaic'] },
    { name: 'Echelon', addresses: ['0x2c7bcc', '0x6a01d5'], keywords: ['echelon'] },
    { name: 'Aries', addresses: ['0xe399b9'], keywords: ['aries'] },
    { name: 'Yuzu', addresses: ['0x4bf519', '0x46566b'], keywords: ['yuzu'] },
    { name: 'LayerBank', addresses: ['0xf257d4'], keywords: ['layerbank'] },
    { name: 'Canopy', addresses: ['0x717b41', '0xb10bd3', '0x5cd341', '0x113a1769acc5ce21b5ece6f9533eef6dd34c758911fa5235124c87ff1298633b'], keywords: ['canopy', 'stmove', 'multi_rewards'] },
    { name: 'MovePosition', addresses: ['0xccd262'], keywords: ['moveposition'] },
    { name: 'Joule', addresses: ['0x6a1641'], keywords: ['joule'] },
    { name: 'Meridian', addresses: ['0x8f396e', '0x2712eb', '0xfbdb3d', '0x88def5'], keywords: ['meridian'] },
    { name: 'Tradeport', addresses: ['0xf81bea'], keywords: ['tradeport'] },
    { name: 'Moversmap', addresses: ['0x8c15ae'], keywords: ['moversmap'] },
    { name: 'Move Match', addresses: ['0xf598f0'], keywords: ['movematch', 'fantasy_epl'] },
    { name: 'Route-X', addresses: ['0x201136'], keywords: ['routex'] },
    { name: 'Movement Bridge', addresses: [], keywords: ['bridge'] },
    { name: 'Capygo', addresses: ['0x8b02d210a22482ba7c36c55629716f36aaff65536971fceae73ec4227ab3022a', '0xfb232241c37c2006ccfd2d36a0ac18f8baff7fa06a3336ba88cfebcfc7a54ac3'], keywords: ['capygo', 'charge_miner'] },
    { name: 'Razor DEX', addresses: ['0x4c5058bc4cd77fe207b8b9990e8af91e1055b814073f0596068e3b95a7ccd31a', '0xc4e68f29fa608d2630d11513c8de731b09a975f2f75ea945160491b9bfd36992', '0xc36ceb6d7b137cea4897d4bc82d8e4d8be5f964c4217dbc96b0ba03cc64070f4'], keywords: ['razordex', 'razor', 'amm_router', 'fungible_asset_router'] },
    { name: 'Asspad', addresses: ['0x880a0e567964e7a9fdc5370da9f2f82139c27927534a4a73ea2e19ffc509a8a'], keywords: ['asspad', 'mint_edition_nfts'] },
    { name: 'Daftar', addresses: ['0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69'], keywords: ['daftar', 'create_badge'] }
  ];

  // 2. Helpers
  const getSuffix = (fn: string) => fn.includes('::') ? fn.split('::').pop() || '' : fn;
  const suffix = getSuffix(functionId.toLowerCase());

  const resolveSymbol = (assetType: string) => {
    if (!assetType) return 'Unknown';
    if (assetType.includes('aptos_coin')) return 'MOVE';
    return assetType.split('::').pop()?.replace(/[<>]/g, '') || 'Token';
  };

  const nativeGasAmount = ut.gas_used ? (Number(ut.gas_used) * Number(ut.gas_unit_price || 0)) / 1e8 : 0;

  const normalizeActivity = (act: any) => {
    const type = String(act.type || act.activity_type || '').toLowerCase();
    const owner = String(act.owner_address || act.owner || '').toLowerCase();
    const isUser = owner === userAddr;
    
    let direction: 'in' | 'out' | null = null;
    if (type.includes('deposit') || type.includes('received') || type.includes('credit') || type.includes('mint')) {
      direction = isUser ? 'in' : null;
    } else if (type.includes('withdraw') || type.includes('sent') || type.includes('debit') || type.includes('burn')) {
      direction = isUser ? 'out' : null;
    } else if (type.includes('transfer')) {
      // Logic for generic transfers
      direction = isUser ? (type.includes('withdraw') ? 'out' : 'in') : null;
    }

    const decimals = act.metadata?.decimals || 8;
    const amount = Math.abs(Number(act.amount || 0)) / Math.pow(10, decimals);
    const assetType = act.asset_type || act.coin_type || '';

    // Filter out native gas fee deductions from activity flows to prevent false swaps
    const isGasFee = (assetType.includes('aptos_coin') || assetType === '0x1' || assetType === '0xa') && 
                      Math.abs(amount - nativeGasAmount) < 0.00005;
    if (isGasFee) return null;

    const symbol = act.metadata?.symbol || resolveSymbol(assetType);

    return { direction, amount, symbol, assetType };
  };

  // 3. Process Activities
  const rawActivities = [
    ...(tx.fungible_asset_activities || []),
    ...(tx.coin_activities || [])
  ];
  
  const activities = rawActivities.map(normalizeActivity).filter(a => a && a.direction);
  const inFlows = activities.filter(a => a?.direction === 'in');
  const outFlows = activities.filter(a => a?.direction === 'out');

  // Resolve Counterparty Address & Label
  let counterpartyAddress = null;
  let counterpartyLabel = null;

  for (const act of rawActivities) {
    const owner = normalizeAddress(act.owner_address || act.owner);
    if (owner && owner !== userAddr && owner !== '0x1' && owner !== '0x3' && owner !== '0xa' && owner !== '0x0000000000000000000000000000000000000000000000000000000000000001') {
      counterpartyAddress = owner;
      break;
    }
  }

  if (!counterpartyAddress) {
    const sender = normalizeAddress(tx.user_transaction?.sender);
    if (sender && sender !== userAddr) {
      counterpartyAddress = sender;
    }
  }

  let isExchangeDeposit = false;
  let exchangeName = null;

  if (counterpartyAddress && labelsMap.has(counterpartyAddress)) {
    const labelObj = labelsMap.get(counterpartyAddress);
    counterpartyLabel = labelObj.tracked_entities?.name || labelObj.label_name || null;

    // Detect if counterparty is an exchange deposit address
    const isExchangeCategory = labelObj.tracked_entities?.category === 'Exchange';
    const isKnownExchangeName = labelObj.tracked_entities?.name && KNOWN_EXCHANGES.has(labelObj.tracked_entities.name);
    const isDepositLabel = labelObj.label_name && (
      labelObj.label_name.toLowerCase().includes('deposit') ||
      labelObj.label_name.toLowerCase().includes('exchange')
    );

    if (isExchangeCategory || isKnownExchangeName || isDepositLabel) {
      isExchangeDeposit = true;
      exchangeName = labelObj.tracked_entities?.name || 'Exchange';
      if (exchangeName === 'Exchange' && labelObj.label_name) {
        for (const ex of KNOWN_EXCHANGES) {
          if (labelObj.label_name.toLowerCase().includes(ex.toLowerCase())) {
            exchangeName = ex;
            break;
          }
        }
      }
    }
  }

  // 4. Decode Events for Richer Context
  const events = [
    ...(tx.fungible_asset_activities || []),
    ...(tx.coin_activities || []),
    ...(tx.events || [])
  ];
  
  let eventTypeOverride = null;
  for (const evt of events) {
    const evtType = String(evt.type || '').toLowerCase();
    for (const [schemaKey, schema] of Object.entries(EVENT_SCHEMAS)) {
      if (evtType.includes(schemaKey.toLowerCase())) {
        eventTypeOverride = schema.type;
        break;
      }
    }
  }

  // 5. Classification
  let protocol = 'Unknown';
  const lowerFn = functionId.toLowerCase();

  // Extract address prefix from entry_function_id_str
  let functionAddress = null;
  if (functionId.includes('::')) {
    const parts = functionId.split('::');
    functionAddress = normalizeAddress(parts[0]);
  }

  // Look up by address prefix in tracked_entities (database)
  if (functionAddress && entitiesList.length > 0) {
    const matchedEntity = entitiesList.find(e => normalizeAddress(e.address) === functionAddress);
    if (matchedEntity) {
      protocol = matchedEntity.name;
    }
  }

  // Fallback: Search by keywords in database, or static fallback list
  if (protocol === 'Unknown') {
    if (entitiesList.length > 0) {
      for (const entity of entitiesList) {
        const keywords: string[] = Array.isArray(entity.keywords) 
          ? entity.keywords 
          : (entity.custom_type ? String(entity.custom_type).split(',').map(k => k.trim()) : []);
          
        const allKeywords = [...keywords, entity.name.toLowerCase().replace(/\s/g, '')];

        if (allKeywords.some(kw => kw && lowerFn.includes(kw.toLowerCase()))) {
          protocol = entity.name;
          break;
        }
      }
    } else {
      // Static fallback if database has no records
      for (const p of STATIC_PROTOCOLS) {
        if (p.addresses.some(addr => lowerFn.includes(addr)) || p.keywords.some(kw => lowerFn.includes(kw))) {
          protocol = p.name;
          break;
        }
      }
    }
  }

  // Fallback to counterparty label if protocol is Unknown or Movement Core (e.g. for transfers to exchanges)
  if ((protocol === 'Unknown' || protocol === 'Movement Core') && counterpartyLabel) {
    protocol = isExchangeDeposit ? exchangeName : counterpartyLabel;
  }

  let action = eventTypeOverride || FUNC_MAP[suffix] || TX_TYPES.OTHER;
  
  // Fallback to direction-based classification if OTHER
  if (action === TX_TYPES.OTHER) {
    if (inFlows.length > 0 && outFlows.length > 0) action = TX_TYPES.SWAP;
    else if (inFlows.length > 0) action = TX_TYPES.RECEIVE;
    else if (outFlows.length > 0) action = TX_TYPES.SEND;
  }

  // Handle exchange deposit classification override
  if (isExchangeDeposit && action === TX_TYPES.SEND) {
    protocol = exchangeName;
  }

  let category = (action === TX_TYPES.SEND || action === TX_TYPES.RECEIVE) ? 'Transfer' : 'DeFi';

  // 6. Generate Description & Metadata
  let description = 'Contract interaction';
  let primaryIn = inFlows[0];
  let primaryOut = outFlows[0];

  // Custom high-fidelity override for Tradeport NFT Buy/Accept Bid transactions on backend
  if (protocol === 'Tradeport') {
    const tradeportFlow = processTradeportAssets(suffix, events, primaryIn, primaryOut);
    primaryIn = tradeportFlow.primaryIn;
    primaryOut = tradeportFlow.primaryOut;
  }

  if (protocol === 'Move Match') {
    if (suffix === 'register_team') {
      description = `Registered Fantasy Squad in Move Match`;
    } else if (suffix === 'buy_title') {
      description = `Purchased Player Title on Move Match`;
    } else if (suffix === 'reroll_title') {
      description = `Rerolled Player Title on Move Match`;
    } else if (suffix === 'buy_guild') {
      description = `Purchased Guild on Move Match`;
    } else if (suffix === 'reroll_guild') {
      description = `Rerolled Guild on Move Match`;
    } else if (suffix === 'claim_prize') {
      const prizeClaimedEvt = events.find(e => String(e.type || '').toLowerCase().includes('prizeclaimed'));
      const amount = primaryIn?.amount || (prizeClaimedEvt?.data?.amount ? Number(prizeClaimedEvt.data.amount) / 1e8 : null);
      description = amount ? `Claimed ${amount.toFixed(2)} MOVE prize winnings from Move Match` : `Claimed prize winnings from Move Match`;
    } else if (suffix === 'admin_sponsor_prize_pool') {
      const prizeSponsoredEvt = events.find(e => String(e.type || '').toLowerCase().includes('prizepoolsponsored'));
      const amount = primaryOut?.amount || (prizeSponsoredEvt?.data?.amount ? Number(prizeSponsoredEvt.data.amount) / 1e8 : null);
      description = amount ? `Sponsored ${amount.toFixed(2)} MOVE to Move Match prize pool` : `Sponsored prize pool for Move Match`;
    } else {
      description = `${suffix.charAt(0).toUpperCase() + suffix.slice(1).replace(/_/g, ' ')} via Move Match`;
    }
  } else if (protocol === 'Tradeport') {
    description = generateTradeportDescription(suffix, events, primaryIn, primaryOut);
  } else if (action === TX_TYPES.SWAP) {
    if (primaryIn && primaryOut) {
      description = `Swapped ${primaryOut.amount.toFixed(2)} ${primaryOut.symbol} for ${primaryIn.amount.toFixed(2)} ${primaryIn.symbol}`;
    } else {
      description = `Swapped assets via ${protocol}`;
    }
  } else if (action === TX_TYPES.SEND || action === TX_TYPES.RECEIVE) {
    if (isExchangeDeposit && action === TX_TYPES.SEND) {
      description = `${exchangeName} Deposit`;
    } else {
      const asset = primaryOut || primaryIn;
      if (asset) {
        if (counterpartyLabel) {
          description = `${action === TX_TYPES.SEND ? 'Sent' : 'Received'} ${asset.amount.toFixed(2)} ${asset.symbol} ${action === TX_TYPES.SEND ? 'to' : 'from'} ${counterpartyLabel}`;
        } else {
          description = `${action === TX_TYPES.SEND ? 'Sent' : 'Received'} ${asset.amount.toFixed(2)} ${asset.symbol}`;
        }
      }
    }
  } else if (action === TX_TYPES.LEND || action === TX_TYPES.DEPOSIT) {
    const asset = primaryOut || primaryIn;
    description = asset ? `Deposited ${asset.amount.toFixed(2)} ${asset.symbol} into ${protocol}` : `Deposited into ${protocol}`;
  } else if (action === TX_TYPES.CLAIM) {
    const asset = primaryIn;
    description = asset ? `Claimed ${asset.amount.toFixed(2)} ${asset.symbol} rewards` : `Claimed rewards from ${protocol}`;
  } else {
    description = `${action.charAt(0) + action.slice(1).toLowerCase().replace('_', ' ')} via ${protocol}`;
  }

  return {
    user_address: walletAddress,
    version: tx.transaction_version,
    hash: ut.hash || `v${tx.transaction_version}`,
    timestamp: ut.timestamp,
    protocol,
    action,
    category,
    description,
    asset_in_symbol: primaryIn?.symbol || null,
    asset_in_amount: primaryIn?.amount || null,
    asset_out_symbol: primaryOut?.symbol || null,
    asset_out_amount: primaryOut?.amount || null,
    gas_usd: ut.gas_used ? (Number(ut.gas_used) * Number(ut.gas_unit_price || 0)) / 1e8 : null,
    metadata: {
      hash: ut.hash,
      entry_function_id_str: functionId,
      success: ut.success ?? tx.user_transaction?.success ?? true,
      gas_used: ut.gas_used != null ? Number(ut.gas_used) : null,
      gas_unit_price: ut.gas_unit_price != null ? Number(ut.gas_unit_price) : null,
      fungible_asset_activities: tx.fungible_asset_activities || [],
      coin_activities: tx.coin_activities || []
    },
    is_processed: false
  };
}

/**
 * Main deep sync loop
 */
export async function syncFullUserHistory(
  supabase: SupabaseClient,
  walletAddress: string
) {
  const address = normalizeAddress(walletAddress);
  const BATCH_SIZE = 50;
  let totalSynced = 0;

  console.log(`[DeepSync] 🚀 Starting deep history pull for ${address}...`);

  // Fetch all labels for counterparty identification
  const labelsMap = new Map();
  const labelsData = await fetchAllAddressLabels(supabase);
  labelsData.forEach(l => labelsMap.set(normalizeAddress(l.address), l));

  // Fetch all tracked entities for dynamic protocol classification
  const { data: entitiesData } = await supabase
    .from('tracked_entities')
    .select('*');
  const entitiesList = entitiesData || [];

  // 1. Fetch current sync status
  const { data: statusData } = await supabase
    .from('user_sync_status')
    .select('*')
    .eq('user_address', address)
    .maybeSingle();

  // 2. Fetch total transaction count from indexer
  let totalTransactions = statusData?.total_transactions || 0;
  try {
    const countRes = await fetch(MOVEMENT_INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query TotalTransactions($address: String!) {
          account_transactions_aggregate(where: { account_address: { _eq: $address } }) {
            aggregate { count }
          }
        }`,
        variables: { address }
      })
    });
    const countJson: any = await countRes.json();
    const indexerCount = countJson.data?.account_transactions_aggregate?.aggregate?.count || 0;
    
    // Only update if indexerCount is greater to prevent progress resetting
    if (indexerCount > totalTransactions) {
      totalTransactions = indexerCount;
    }
  } catch (e) {
    console.warn(`[DeepSync] Could not fetch total count for ${address}, using fallback: ${totalTransactions}`);
  }

  const { data: maxData } = await supabase
    .from('user_transaction_history')
    .select('version')
    .eq('user_address', address)
    .order('version', { ascending: false })
    .limit(1);

  const { data: minData } = await supabase
    .from('user_transaction_history')
    .select('version')
    .eq('user_address', address)
    .order('version', { ascending: true })
    .limit(1);

  let maxVersionStr = maxData && maxData.length > 0 ? String(maxData[0].version) : "0";
  let minVersionStr = minData && minData.length > 0 ? String(minData[0].version) : "9223372036854775807";

  // CRITICAL FIX: If the history table was cleared manually, reset the sync status
  let isFullySynced = statusData?.full_history_synced === true;
  if (maxVersionStr === "0" && isFullySynced) {
    console.log(`[DeepSync] ⚠️ History was cleared but status was 'synced'. Resetting for ${address}...`);
    isFullySynced = false;
    await supabase.from('user_sync_status').update({ 
      full_history_synced: false, 
      synced_transactions: 0,
      total_transactions: totalTransactions // Update with latest discovery
    }).eq('user_address', address);
  }

  // Mark status as currently syncing with total count
  await supabase.from('user_sync_status').upsert({
    user_address: address,
    last_sync_at: new Date().toISOString(),
    full_history_synced: false,
    total_transactions: totalTransactions,
    synced_transactions: statusData?.synced_transactions || 0
  });

  try {
    // --- PHASE 1: FORWARD SYNC (New Transactions) ---
    console.log(`[DeepSync] Phase 1: Forward Sync from > ${maxVersionStr}`);
    let gtVersion = maxVersionStr;
    let hasMoreForward = true;
    let forwardBatchCount = 0;
    const MAX_FORWARD_BATCHES = 50;

    while (hasMoreForward && forwardBatchCount < MAX_FORWARD_BATCHES) {
      forwardBatchCount++;

      const response = await fetch(MOVEMENT_INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GET_USER_TRANSACTIONS_FORWARD_PAGINATED,
          variables: { address, limit: BATCH_SIZE, gt_version: gtVersion }
        })
      });

      const json: any = await response.json();
      if (json.errors) throw new Error(`Indexer query failed: ${JSON.stringify(json.errors)}`);

      const txs = json.data?.account_transactions || [];
      if (txs.length === 0) {
        hasMoreForward = false;
        break;
      }

      const enriched = txs.map((tx: any) => enrichTransaction(tx, address, labelsMap, entitiesList));
      const { error: upsertError } = await supabase
        .from('user_transaction_history')
        .upsert(enriched, { onConflict: 'user_address,version' });

      if (upsertError) throw upsertError;


      totalSynced += txs.length;
      gtVersion = txs[txs.length - 1].transaction_version;

      // Update progress in DB
      const { count: currentCount } = await supabase
        .from('user_transaction_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_address', address);

      await supabase.from('user_sync_status').update({
        last_synced_version: String(gtVersion),
        synced_transactions: currentCount || totalSynced,
        last_sync_at: new Date().toISOString()
      }).eq('user_address', address);

      if (txs.length < BATCH_SIZE) hasMoreForward = false;
      await new Promise(r => setTimeout(r, 200));
    }

    // Update status to let frontend know we've pulled new items
    await supabase.from('user_sync_status').update({
      last_synced_version: String(gtVersion),
      last_sync_at: new Date().toISOString()
    }).eq('user_address', address);

    // --- PHASE 2: BACKWARD SYNC (Historical Gaps) ---
    let fullyFinishedHistory = isFullySynced;

    if (!isFullySynced) {
      console.log(`[DeepSync] Phase 2: Backward Sync from < ${minVersionStr}`);
      let ltVersion = minVersionStr;
      let hasMoreBackward = true;
      let backwardBatchCount = 0;
      const MAX_BACKWARD_BATCHES = 100;

      while (hasMoreBackward && backwardBatchCount < MAX_BACKWARD_BATCHES) {
        backwardBatchCount++;

        const response = await fetch(MOVEMENT_INDEXER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: GET_USER_TRANSACTIONS_PAGINATED,
            variables: { address, limit: BATCH_SIZE, lt_version: ltVersion }
          })
        });

        const json: any = await response.json();
        if (json.errors) throw new Error(`Indexer query failed: ${JSON.stringify(json.errors)}`);

        const txs = json.data?.account_transactions || [];
        if (txs.length === 0) {
          hasMoreBackward = false;
          fullyFinishedHistory = true; // Reached the beginning of time
          break;
        }

        const enriched = txs.map((tx: any) => enrichTransaction(tx, address, labelsMap, entitiesList));
        const { error: upsertError } = await supabase
          .from('user_transaction_history')
          .upsert(enriched, { onConflict: 'user_address,version' });

        if (upsertError) throw upsertError;


        totalSynced += txs.length;
        ltVersion = txs[txs.length - 1].transaction_version;

        // Update progress in DB
        const { count: currentCount } = await supabase
          .from('user_transaction_history')
          .select('*', { count: 'exact', head: true })
          .eq('user_address', address);

        await supabase.from('user_sync_status').update({
          last_synced_version: String(ltVersion),
          synced_transactions: currentCount || totalSynced,
          last_sync_at: new Date().toISOString()
        }).eq('user_address', address);

        if (txs.length < BATCH_SIZE) {
          hasMoreBackward = false;
          fullyFinishedHistory = true;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (backwardBatchCount >= MAX_BACKWARD_BATCHES) {
        console.warn(`[DeepSync] ⚠️ Backward sync budget reached. More history remains.`);
        fullyFinishedHistory = false;
      }
    }

    // Finalize sync status
    await supabase.from('user_sync_status').update({
      full_history_synced: fullyFinishedHistory,
      last_sync_at: new Date().toISOString()
    }).eq('user_address', address);

    // Trigger portfolio reconstruction to update snapshots only if new transactions were synced
    if (totalSynced > 0) {
      try {
        await reconstructHistoricalBalances(supabase, address);
      } catch (reconstructErr) {
        console.error(`[DeepSync] ⚠️ Portfolio reconstruction failed but sync succeeded:`, reconstructErr);
      }
    } else {
      console.log(`[DeepSync] No new transactions synced. Skipping portfolio reconstruction for ${address}.`);
    }

    return { totalSynced };

  } catch (err: any) {
    console.error(`[DeepSync] ❌ Fatal error for ${address}:`, err.message);
    await supabase.from('user_sync_status').update({ sync_error: err.message }).eq('user_address', address);
    throw err;
  }
}

/**
 * Maintenance function to fix "Unknown" protocols in DB
 */
export async function reProcessUnknownTransactions(supabase: SupabaseClient) {
  console.log('[DeepSync] 🛠️  Starting "Unknown" protocol cleanup...');

  // 1. Fetch labels once
  const labelsMap = new Map();
  const labelsData = await fetchAllAddressLabels(supabase);
  labelsData.forEach(l => labelsMap.set(normalizeAddress(l.address), l));

  // Fetch all tracked entities for dynamic protocol classification
  const { data: entitiesData } = await supabase
    .from('tracked_entities')
    .select('*');
  const entitiesList = entitiesData || [];

  // 2. Fetch all transactions marked as Unknown (limited batch)
  const { data: unknowns, error } = await supabase
    .from('user_transaction_history')
    .select('*')
    .eq('protocol', 'Unknown')
    .limit(500);

  if (error || !unknowns) return;

  console.log(`[DeepSync] Found ${unknowns.length} unknown transactions to re-process.`);

  for (const row of unknowns) {
    try {
      const meta = row.metadata || {};

      // Reconstruct a compatible 'tx' object for enrichTransaction
      const pseudoTx = {
        transaction_version: row.version,
        user_transaction: {
          hash: row.hash,
          timestamp: row.timestamp,
          entry_function_id_str: meta.entry_function_id_str || '',
          success: meta.success ?? true
        },
        fungible_asset_activities: meta.fungible_asset_activities || [],
        coin_activities: meta.coin_activities || []
      };

      const enriched = enrichTransaction(pseudoTx, row.user_address, labelsMap, entitiesList);

      // Update the row
      await supabase
        .from('user_transaction_history')
        .update({
          protocol: enriched.protocol,
          action: enriched.action,
          category: enriched.category,
          description: enriched.description,
          asset_in_symbol: enriched.asset_in_symbol,
          asset_in_amount: enriched.asset_in_amount,
          asset_out_symbol: enriched.asset_out_symbol,
          asset_out_amount: enriched.asset_out_amount
        })
        .eq('user_address', row.user_address)
        .eq('version', row.version);

    } catch (err) {
      console.error(`[DeepSync] Failed to re-process version ${row.version}`);
    }
  }

  console.log('[DeepSync] ✅ Cleanup complete.');
}
