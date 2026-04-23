import { CANOPY_CONFIG, YUZU_CONFIG } from "./network.js";
import { DEFI_PROTOCOLS } from "./protocols.js";

const normalizeAddress = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith("0x") ? raw : `0x${raw}`;
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
  modulePrefixes: Array.from(new Set(modulePrefixes.map((value) => String(value || "").toLowerCase()))),
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
    keywords: ["lend", "supply", "borrow", "repay"],
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
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::rewards::",
      "0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2::oracle::",
    ],
    keywords: ["joule", "lend", "supply", "borrow", "repay"],
  }),
  createDapp({
    key: "moveposition",
    protocol: DEFI_PROTOCOLS.MOVEPOSITION,
    logo: "/moveposition.png",
    keywords: ["lend", "supply", "borrow", "repay", "portfolio"],
  }),
  createDapp({
    key: "meridian",
    protocol: DEFI_PROTOCOLS.MERIDIAN,
    logo: "/Meridian.png",
    contracts: [
      "0x2712eba673b52416fa5f11504ff70d3f9e48edff9c32f2201f1468c27ed3fe04",
      "0xfbdb3da73efcfa742d542f152d65fc6da7b55dee864cd66475213e4be18c9d54",
    ],
    modulePrefixes: [
      "0x2712eba673b52416fa5f11504ff70d3f9e48edff9c32f2201f1468c27ed3fe04::router::",
      "0xfbdb3da73efcfa742d542f152d65fc6da7b55dee864cd66475213e4be18c9d54::pool::",
      "0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82::",
    ],
    keywords: ["cdp", "mint", "redeem", "swap", "liquidity"],
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
    modulePrefixes: [
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::supply_logic::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::borrow_logic::",
      "0xf257d40859456809be19dfee7f4c55c4d033680096aeeb4228b7a15749ab68ea::rewards_distributor",
    ],
    keywords: ["lend", "supply", "borrow", "repay", "pool", "lmove"],
  }),
  createDapp({
    key: "mosaic",
    protocol: DEFI_PROTOCOLS.MOSAIC,
    logo: "/mosaic.png",
    contracts: [
      "0x3f7399a0d3d646ce94ee0badf16c4c3f3c656fe3a5e142e83b5ebc011aa8b3d",
    ],
    modulePrefixes: [
      "0x3f7399a0d3d646ce94ee0badf16c4c3f3c656fe3a5e142e83b5ebc011aa8b3d::router::",
      "0xede23ef215f0594e658b148c2a391b1523335ab01495d8637e076ec510c6ec3c::",
    ],
    keywords: ["swap", "router", "amm", "liquidity", "farming"],
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
      score += 100;
    }

    if (normalizedAddresses.some((address) => dapp.contracts.includes(address))) {
      score += 80;
    }

    if (dapp.contracts.some((address) => text.includes(address))) {
      score += 60;
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