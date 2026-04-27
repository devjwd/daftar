import { CANOPY_CONFIG, YUZU_CONFIG } from "./network.js";
import { DEFI_PROTOCOLS } from "./protocols.js";

const normalizeAddress = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  const compact = stripped.replace(/^0+/, "") || "0";
  return `0x${compact}`;
};

const normalizeModulePrefix = (value) => {
  const parts = String(value || "").split("::");
  if (parts.length < 2) return value.toLowerCase();
  const addr = normalizeAddress(parts[0]);
  return `${addr}::${parts.slice(1).join("::")}`.toLowerCase();
};

const uniqueAddresses = (values = []) => {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = normalizeAddress(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
};

const createDapp = ({
  key,
  protocol,
  logo,
  keywords = [],
  modulePrefixes = [],
  contracts = [],
}) => ({
  key,
  name: protocol.name,
  website: protocol.website || null,
  protocolType: protocol.type || "DeFi",
  logo,
  contracts: uniqueAddresses([...(protocol.addresses || []), ...(contracts || [])]),
  keywords: Array.from(new Set([...(protocol.keywords || []), ...keywords])).map((value) => String(value || "").toLowerCase()),
  modulePrefixes: Array.from(new Set(modulePrefixes.map((value) => normalizeModulePrefix(value)))),
});

export const TRACKED_DAPPS = [
  createDapp({
    key: "daftar",
    protocol: {
      name: "DAFTAR swap",
      website: "https://daftar.fi",
      type: "Portfolio",
      addresses: [
        "0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69", // Admin/Treasury
      ],
      keywords: ["daftar", "portfolio", "swap"],
    },
    logo: "/daftar%20icon.png",
    contracts: ["0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69"],
    keywords: ["daftar", "swap", "portfolio"],
  }),
  createDapp({
    key: "capygo",
    protocol: {
      name: "Capygo",
      website: null,
      type: "Mining",
      addresses: ["0x8b02d210a22482ba7c36c55629716f36aaff65536971fceae73ec4227ab3022a"],
      keywords: ["capygo", "mining", "claim_rewards", "depositnative", "relay"],
    },
    logo: "/Capygo.png",
    modulePrefixes: ["0x8b02d210a22482ba7c36c55629716f36aaff65536971fceae73ec4227ab3022a::mining::"],
    keywords: ["claim_rewards", "facility", "miner", "capycoin"],
  }),
  createDapp({
    key: "echelon",
    protocol: DEFI_PROTOCOLS.ECHELON,
    logo: "/Echelon.png",
    modulePrefixes: [
      "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5::scripts::",
      "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5::lending::",
      "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5::farming::",
      "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5::borrow::",
      "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5::tiered_oracle::",
    ],
    keywords: ["echelon", "supply", "withdraw", "claim_reward", "money_market", "isolated", "lend", "borrow", "repay"],
  }),
  createDapp({
    key: "joule",
    protocol: DEFI_PROTOCOLS.JOULE,
    logo: "/joule-finance.png",
    contracts: [
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2",
    ],
    modulePrefixes: [
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::pool::",
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::money_market::",
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::lend::",
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::rewards::",
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::oracle::",
    ],
    keywords: ["joule", "lend", "money_market", "isolated", "supply", "borrow", "repay"],
  }),
  createDapp({
    key: "moveposition",
    protocol: DEFI_PROTOCOLS.MOVEPOSITION,
    logo: "/moveposition.png",
    contracts: [
      "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf",
    ],
    modulePrefixes: [
      "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::entry_public::",
      "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::lend::",
      "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::borrow::",
      "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::hocket::",
    ],
    keywords: ["moveposition", "lend_v2", "borrow_v2", "hocket", "broker", "lend", "supply", "borrow", "repay"],
  }),
  createDapp({
    key: "meridian",
    protocol: DEFI_PROTOCOLS.MERIDIAN,
    logo: "/Meridian.png",
    contracts: [
      "0x2712eba673b52416fa5f11504ff70d3f9e48edff9c32f2201f1468c27ed3fe04",
      "0xfbdb3da73efcfa742d542f152d65fc6da7b55dee864cd66475213e4be18c9d54",
      "0x88def51006db6ae8f90051a1531d1b43877eeb233f4c0d99dcb24f49cd27ad5b",
    ],
    modulePrefixes: [
      "0x2712eba673b52416fa5f11504ff70d3f9e48edff9c32f2201f1468c27ed3fe04::router::",
      "0x2712eba673b52416fa5f11504ff70d3f9e48edff9c32f2201f1468c27ed3fe04::scripts::",
      "0xfbdb3da73efcfa742d542f152d65fc6da7b55dee864cd66475213e4be18c9d54::pool::",
      "0x88def51006db6ae8f90051a1531d1b43877eeb233f4c0d99dcb24f49cd27ad5b::pool::",
      "0x88def51006db6ae8f90051a1531d1b43877eeb233f4c0d99dcb24f49cd27ad5b::oracle::",
      "0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82::",
    ],
    keywords: ["meridian", "swap_exact_in_router_entry", "new_position", "pool", "liquidity", "swap"],
  }),
  createDapp({
    key: "canopy",
    protocol: DEFI_PROTOCOLS.CANOPY,
    logo: "/canopy.png",
    contracts: [
      CANOPY_CONFIG.coreRouterAddress,
      CANOPY_CONFIG.coreVaultsAddress,
      CANOPY_CONFIG.liquidswapVaultsAddress,
      CANOPY_CONFIG.rewardsAddress,
    ],
    modulePrefixes: [
      `${String(CANOPY_CONFIG.coreRouterAddress || '').toLowerCase()}::router::`,
      `${String(CANOPY_CONFIG.coreRouterAddress || '').toLowerCase()}::deposit::`,
      `${String(CANOPY_CONFIG.coreRouterAddress || '').toLowerCase()}::withdraw::`,
      `${String(CANOPY_CONFIG.coreRouterAddress || '').toLowerCase()}::harvest::`,
      `${String(CANOPY_CONFIG.coreRouterAddress || '').toLowerCase()}::auth::`,
      `${String(CANOPY_CONFIG.coreVaultsAddress || '').toLowerCase()}::vault::`,
      `${String(CANOPY_CONFIG.coreVaultsAddress || '').toLowerCase()}::base_strategy::`,
      `${String(CANOPY_CONFIG.coreVaultsAddress || '').toLowerCase()}::asset::`,
      `${String(CANOPY_CONFIG.liquidswapVaultsAddress || '').toLowerCase()}::`,
      `${String(CANOPY_CONFIG.rewardsAddress || '').toLowerCase()}::`,
    ],
    keywords: ["stmove", "cvmove", "vault", "canopyhub", "deposit_coin", "deposit_fa", "withdraw_coin", "withdraw_fa", "harvest"],
  }),
  createDapp({
    key: "gmove",
    protocol: {
      ...DEFI_PROTOCOLS.MOVEMENT,
      name: "Movement Native Staking",
      addresses: ["0xb52bac12e50458cd2b958b82b05e3a240834eefbfc4b1bc0729fd580c625f1ea"],
    },
    logo: "/gmove.png",
    contracts: ["0xb52bac12e50458cd2b958b82b05e3a240834eefbfc4b1bc0729fd580c625f1ea"],
    modulePrefixes: [
      "0xb52bac12e50458cd2b958b82b05e3a240834eefbfc4b1bc0729fd580c625f1ea::liquid_staking::",
    ],
    keywords: ["gmove", "stake_and_mint", "liquid_staking", "mint"],
  }),
  createDapp({
    key: "movement",
    protocol: DEFI_PROTOCOLS.MOVEMENT,
    logo: "/movement-logo.svg",
    contracts: [],
    keywords: [
      "delegation_pool",
      "add_stake",
      "unlock",
      "reactivate_stake",
      "withdraw_pending_inactive",
      "get_pending_withdrawal",
    ],
    modulePrefixes: ["0x1::delegation_pool::"],
  }),
  createDapp({
    key: "layerbank",
    protocol: DEFI_PROTOCOLS.LAYERBANK,
    logo: "/LayerBank.png",
    contracts: [
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea",
    ],
    modulePrefixes: [
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::supply_logic::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::borrow_logic::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::rewards_distributor::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::rewards_controller_v2::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::pool::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::token_base::",
    ],
    keywords: ["layerbank", "supply", "supply_logic", "aave_fork", "universal_bank", "lend", "borrow", "repay", "lmove"],
  }),
  createDapp({
    key: "mosaic",
    protocol: DEFI_PROTOCOLS.MOSAIC,
    logo: "/mosaic.png",
    contracts: [
      "0x03f7399a0d3d646ce94ee0badf16c4c3f3c656fe3a5e142e83b5ebc011aa8b3d",
      "0x26a95d4bd7d7fc3debf6469ff94837e03e887088bef3a3f2d08d1131141830d3",
      "0xede23ef215f0594e658b148c2a391b1523335ab01495d8637e076ec510c6ec3c",
    ],
    modulePrefixes: [
      "0x3f7399a0d3d646ce94ee0badf16c4c3f3c656fe3a5e142e83b5ebc011aa8b3d::router::",
      "0x03f7399a0d3d646ce94ee0badf16c4c3f3c656fe3a5e142e83b5ebc011aa8b3d::router::",
      "0x26a95d4bd7d7fc3debf6469ff94837e03e887088bef3a3f2d08d1131141830d3::treasury::",
      "0xede23ef215f0594e658b148c2a391b1523335ab01495d8637e076ec510c6ec3c::",
    ],
    keywords: ["mosaic", "mosaic_aggregator", "swap", "aggregator", "route", "dex", "router", "amm", "liquidity"],
  }),
  createDapp({
    key: "razor",
    protocol: DEFI_PROTOCOLS.RAZOR,
    logo: "/razor.png",
    contracts: [
      "0xc4e68f29fa608d2630d11513c8de731b09a975f2f75ea945160491b9bfd36992",
    ],
    modulePrefixes: [
      "0xc4e68f29fa608d2630d11513c8de731b09a975f2f75ea945160491b9bfd36992::amm_router::",
      "0xc4e68f29fa608d2630d11513c8de731b09a975f2f75ea945160491b9bfd36992::amm_pair::",
    ],
    keywords: [
      "razor",
      "razordex",
      "swap_exact_move_for_tokens",
      "swap_exact_tokens_for_move",
      "swap_exact_tokens_for_tokens",
      "amm_router",
      "amm_pair",
      "liquidity",
      "farm",
      "staking",
    ],
  }),
  createDapp({
    key: "yuzu",
    protocol: DEFI_PROTOCOLS.YUZU,
    logo: "/yuzu.png",
    contracts: [
      YUZU_CONFIG.packageAddress,
      "0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a",
    ],
    modulePrefixes: [
      `${String(YUZU_CONFIG.packageAddress || '').toLowerCase()}::`,
      '0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a::scripts::',
      '0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a::liquidity_pool::',
    ],
    keywords: [
      "swap",
      "clmm",
      "liquidity",
      "farming",
      "pool",
      "swap_exact_coin_for_fa_multi_hops",
      "liquidity_pool::swapevent",
    ],
  }),
  createDapp({
    key: "routex",
    protocol: {
      name: "Route-X",
      type: "DEX",
      website: "https://routex.io",
      addresses: ["0x20113646d879e65901b93634c3303914692d716db98d514ffa7845a01e22dc44"],
    },
    logo: "/routex.png",
    modulePrefixes: ["0x20113646d879e65901b93634c3303914692d716db98d514ffa7845a01e22dc44::routexfa::"],
    keywords: ["swap", "router", "routex"],
  }),
  createDapp({
    key: "tradeport",
    protocol: {
      name: "Tradeport",
      type: "NFT Marketplace",
      website: "https://tradeport.xyz",
      addresses: ["0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0"],
    },
    logo: "/tradeport.png",
    contracts: [
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0",
    ],
    modulePrefixes: [
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0::router::",
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0::listings_v2::",
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0::biddings_v2::",
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0::markets_v2::",
      "0xf81bea5757d1ff70b441b1ec64db62436df5f451cde6eab81aec489791f22aa0::transfers_v2::",
    ],
    keywords: ["tradeport", "nft", "marketplace", "bid", "list", "buy"],
  }),
  createDapp({
    key: "brkt",
    protocol: {
      name: "BRKT",
      type: "Prediction Market",
      website: "https://brkt.gg",
      addresses: ["0xc85e095d7dbaab7ce22c3b1f18623ff4ab3b95887d08389a4a644c894a22585"],
    },
    logo: "/brkt.png",
    modulePrefixes: ["0xc85e095d7dbaab7ce22c3b1f18623ff4ab3b95887d08389a4a644c894a22585::"],
    keywords: ["brkt", "buy", "sell", "shares", "prediction"],
  }),
  createDapp({
    key: "moversmap",
    protocol: {
      name: "Moversmap",
      type: "GameFi",
      website: "https://moversmap.com",
      addresses: ["0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18"],
    },
    logo: "/moversmap.png",
    contracts: [
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18",
    ],
    modulePrefixes: [
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::memory_nft::",
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::gift_ledger::",
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::treasure_claim::",
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::guild_ledger::",
      "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::pin_registry::",
    ],
    keywords: ["moversmap", "mint_memory", "send_gift", "claim_treasure", "guild", "pin"],
  }),
  createDapp({
    key: "pyth",
    protocol: {
      name: "Pyth Network",
      type: "Oracle",
      website: "https://pyth.network",
      addresses: ["0x9357e76fe965c9956a76181ee49f66d51b7f9c3800182a944ed96be86301e49f"],
    },
    logo: "/pyth.png",
    modulePrefixes: ["0x9357e76fe965c9956a76181ee49f66d51b7f9c3800182a944ed96be86301e49f::pyth::"],
    keywords: ["oracle", "price", "pyth"],
  }),
  createDapp({
    key: "warpgate",
    protocol: { name: "Warpgate", type: "DEX" },
    logo: "/warpgate.png",
    keywords: ["swap", "warpgate"],
  }),
  createDapp({
    key: "mmex",
    protocol: { name: "MMEX", type: "Derivatives" },
    logo: "/mmex.png",
    keywords: ["swap", "position", "mmex"],
  }),
  createDapp({
    key: "clobx",
    protocol: { name: "ClobX", type: "DEX" },
    logo: "/clobx.png",
    keywords: ["order", "clobx"],
  }),
  createDapp({
    key: "gorillamoverz",
    protocol: { name: "Gorilla Moverz", type: "NFT" },
    logo: "/gorilla.png",
    keywords: ["mint", "gorilla"],
  }),
  createDapp({
    key: "arkai",
    protocol: { name: "Arkai", type: "NFT" },
    logo: "/arkai.png",
    keywords: ["mint", "arkai"],
  }),
  createDapp({
    key: "coscription",
    protocol: { name: "CoScription", type: "AI" },
    logo: "/coscription.png",
    keywords: ["mint", "coscription"],
  }),
  createDapp({
    key: "nightly",
    protocol: { name: "Nightly Wallet", type: "Wallet" },
    logo: "/nightly.png",
    keywords: ["transfer", "nightly"],
  }),
  createDapp({
    key: "movement_bridge",
    protocol: { name: "Movement Bridge", type: "Bridge" },
    logo: "/movement-logo.svg",
    keywords: ["bridge", "transfer"],
  }),
  createDapp({
    key: "doubleup",
    protocol: { name: "DoubleUp", type: "GambleFi" },
    logo: "/doubleup.png",
    keywords: ["play", "swap", "doubleup"],
  }),
  createDapp({
    key: "hangman_clash",
    protocol: { name: "Hangman Clash", type: "Gaming" },
    logo: "/hangman.png",
    keywords: ["play", "hangman"],
  }),
  createDapp({
    key: "ethena",
    protocol: { name: "Ethena", type: "DeFi" },
    logo: "/ethena.png",
    keywords: ["swap", "mint", "ethena"],
  }),
];


/**
 * Format a database entity into the Dapp structure for matching logic
 */
export const formatDynamicEntity = (entity) => ({
  key: `dynamic_${entity.id}`,
  name: entity.name,
  website: entity.website_url || null,
  protocolType: entity.category || 'Protocol',
  logo: entity.logo_url || '/movement-logo.svg',
  contracts: [normalizeAddress(entity.address)].filter(Boolean),
  keywords: [entity.name.toLowerCase()],
  modulePrefixes: [],
  isDynamic: true
});

export const findTrackedDappMatch = ({ textParts = [], addresses = [], dynamicEntities = [] } = {}) => {
  const text = textParts
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");
 
  const normalizedAddresses = uniqueAddresses(addresses);
 
  let bestMatch = null;
  let bestScore = 0;
 
  const allDapps = [...TRACKED_DAPPS, ...(dynamicEntities || []).map(formatDynamicEntity)];
 
  for (const dapp of allDapps) {
    let score = 0;

    if (dapp.modulePrefixes.some((prefix) => text.includes(prefix))) {
      score += 200; // Increased priority for module prefix match
    }

    if (normalizedAddresses.some((address) => dapp.contracts.includes(address))) {
      score += 150; // Increased priority for contract address match
    }

    if (dapp.contracts.some((address) => text.includes(address))) {
      score += 100;
    }

    for (const keyword of dapp.keywords) {
      if (text.includes(keyword)) {
        score += keyword.length >= 8 ? 12 : 4;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = dapp;
    }
  }

  return bestScore > 0 ? bestMatch : null;
};