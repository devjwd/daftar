import { getBadgeFunction, BADGE_RULES, BADGE_STATUS, getRuleLabel } from "../config/badges";

export const decodeBytes = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      return hexToString(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return String(value);
};

const hexToString = (hex) => {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  let output = "";
  for (let i = 0; i < normalized.length; i += 2) {
    const code = parseInt(normalized.slice(i, i + 2), 16);
    if (!Number.isNaN(code)) {
      output += String.fromCharCode(code);
    }
  }
  return output;
};

export const encodeBase64 = (input) => {
  const utf8 = new TextEncoder().encode(input);
  let binary = "";
  utf8.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

export const buildMetadataJson = ({ name, description, imageUri, externalUrl, attributes }) => {
  return JSON.stringify({
    name: name || "",
    description: description || "",
    image: imageUri || "",
    external_url: externalUrl || "",
    attributes: attributes || [],
  });
};

export const buildMetadataDataUri = (metadataJson) => {
  const encoded = encodeBase64(metadataJson);
  return `data:application/json;base64,${encoded}`;
};

export const computeSha256Hex = async (input) => {
  try {
    const bytes = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    console.error('[badgeService] computeSha256Hex failed:', error.message);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// VIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const fetchBadgeIds = async (client) => {
  try {
    const fn = getBadgeFunction("get_badge_ids");
    if (!fn) return [];

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [],
      },
    });

    return (result && result[0]) || [];
  } catch (error) {
    console.error('[badgeService] fetchBadgeIds failed:', error.message);
    return [];
  }
};

export const fetchActiveBadgeIds = async (client) => {
  try {
    const fn = getBadgeFunction("get_active_badge_ids");
    if (!fn) return [];

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [],
      },
    });

    return (result && result[0]) || [];
  } catch (error) {
    console.error('[badgeService] fetchActiveBadgeIds failed:', error.message);
    return [];
  }
};

export const fetchBadge = async (client, badgeId) => {
  try {
    const fn = getBadgeFunction("get_badge");
    if (!fn) return null;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [badgeId],
      },
    });

    if (!result) return null;

    const [
      id,
      name,
      description,
      imageUri,
      metadataUri,
      metadataHash,
      category,
      rarity,
      xpValue,
      ruleType,
      ruleNote,
      minValue,
      coinTypeStr,
      dappAddress,
      status,
      startsAt,
      endsAt,
      createdAt,
      updatedAt,
      totalMinted,
      maxSupply,
    ] = result;

    return {
      id: Number(id),
      name: decodeBytes(name),
      description: decodeBytes(description),
      imageUri: decodeBytes(imageUri),
      metadataUri: decodeBytes(metadataUri),
      metadataHash: decodeBytes(metadataHash),
      category: decodeBytes(category),
      rarity: Number(rarity),
      xpValue: Number(xpValue),
      ruleType: Number(ruleType),
      ruleNote: decodeBytes(ruleNote),
      minValue: Number(minValue),
      coinTypeStr: decodeBytes(coinTypeStr),
      dappAddress: decodeBytes(dappAddress),
      status: Number(status),
      startsAt: Number(startsAt),
      endsAt: Number(endsAt),
      createdAt: Number(createdAt),
      updatedAt: Number(updatedAt),
      totalMinted: Number(totalMinted),
      maxSupply: Number(maxSupply),
      // Computed
      isActive: Number(status) === BADGE_STATUS.ACTIVE,
      isPaused: Number(status) === BADGE_STATUS.PAUSED,
      isDiscontinued: Number(status) === BADGE_STATUS.DISCONTINUED,
      isTimeLimited: Number(startsAt) > 0 || Number(endsAt) > 0,
      hasMaxSupply: Number(maxSupply) > 0,
    };
  } catch (error) {
    console.error('[badgeService] fetchBadge failed:', error.message);
    return null;
  }
};

export const fetchBadges = async (client) => {
  try {
    const ids = await fetchBadgeIds(client);

    const results = await Promise.all(
      ids.map((badgeId) =>
        fetchBadge(client, badgeId).catch(() => null)
      )
    );

    return results.filter(Boolean);
  } catch (error) {
    console.error('[badgeService] fetchBadges failed:', error.message);
    return [];
  }
};

export const fetchActiveBadges = async (client) => {
  try {
    const ids = await fetchActiveBadgeIds(client);

    const results = await Promise.all(
      ids.map((badgeId) =>
        fetchBadge(client, badgeId).catch(() => null)
      )
    );

    return results.filter(Boolean);
  } catch (error) {
    console.error('[badgeService] fetchActiveBadges failed:', error.message);
    return [];
  }
};

export const hasBadge = async (client, badgeId, owner) => {
  try {
    const fn = getBadgeFunction("has_badge");
    if (!fn) return false;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [owner, badgeId],
      },
    });

    return Boolean(result && result[0]);
  } catch (error) {
    console.error('[badgeService] hasBadge failed:', error.message);
    return false;
  }
};

export const isAllowlisted = async (client, badgeId, owner) => {
  try {
    const fn = getBadgeFunction("is_allowlisted");
    if (!fn) return false;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [owner, badgeId],
      },
    });

    return Boolean(result && result[0]);
  } catch (error) {
    console.error('[badgeService] isAllowlisted failed:', error.message);
    return false;
  }
};

export const isBadgeAvailable = async (client, badgeId) => {
  try {
    const fn = getBadgeFunction("is_badge_available");
    if (!fn) return false;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [badgeId],
      },
    });

    return Boolean(result && result[0]);
  } catch (error) {
    console.error('[badgeService] isBadgeAvailable failed:', error.message);
    return false;
  }
};

export const getBadgeStats = async (client, badgeId) => {
  try {
    const fn = getBadgeFunction("get_badge_stats");
    if (!fn) return { totalMinted: 0, maxSupply: 0, status: BADGE_STATUS.ACTIVE };

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [badgeId],
      },
    });

    if (!result) return { totalMinted: 0, maxSupply: 0, status: BADGE_STATUS.ACTIVE };

    return {
      totalMinted: Number(result[0]),
      maxSupply: Number(result[1]),
      status: Number(result[2]),
    };
  } catch (error) {
    console.error('[badgeService] getBadgeStats failed:', error.message);
    return { totalMinted: 0, maxSupply: 0, status: BADGE_STATUS.ACTIVE };
  }
};

export const getUserBadgeIds = async (client, owner) => {
  try {
    const fn = getBadgeFunction("get_user_badge_ids");
    if (!fn) return [];

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [owner],
      },
    });

    return (result && result[0]) || [];
  } catch (error) {
    console.error('[badgeService] getUserBadgeIds failed:', error.message);
    return [];
  }
};

export const getCoinBalance = async (client, owner, coinType) => {
  try {
    if (!coinType) return 0;

    const result = await client.view({
      payload: {
        function: "0x1::coin::balance",
        typeArguments: [coinType],
        functionArguments: [owner],
      },
    });

    return Number(result && result[0]) || 0;
  } catch (error) {
    console.error('[badgeService] getCoinBalance failed:', error.message);
    return 0;
  }
};

export const getAdmin = async (client) => {
  try {
    const fn = getBadgeFunction("get_admin");
    if (!fn) return null;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [],
      },
    });

    return result && result[0];
  } catch (error) {
    console.error('[badgeService] getAdmin failed:', error.message);
    return null;
  }
};

export const getBadgeFee = async (client, badgeId) => {
  try {
    const fn = getBadgeFunction("get_badge_fee");
    if (!fn) return 0;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [badgeId],
      },
    });

    return Number(result && result[0]) || 0;
  } catch (error) {
    console.error('[badgeService] getBadgeFee failed:', error.message);
    return 0;
  }
};

export const getFeeTreasury = async (client) => {
  try {
    const fn = getBadgeFunction("get_fee_treasury");
    if (!fn) return null;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [],
      },
    });

    return result && result[0];
  } catch (error) {
    console.error('[badgeService] getFeeTreasury failed:', error.message);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS - Badge Creation
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const createBadge = async ({
  signAndSubmitTransaction,
  sender,
  // Metadata
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  category,
  rarity,
  xpValue,
  // Rule config
  ruleType,
  ruleNote,
  minValue,
  coinTypeStr,
  dappAddress,
  extraData,
  // Time limits
  startsAt,
  endsAt,
  // Supply
  maxSupply,
  // Fee
  mintFee,
}) => {
  const fn = getBadgeFunction("create_badge");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        name || "",
        description || "",
        imageUri || "",
        metadataUri || "",
        metadataHash || "",
        category || "activity",
        rarity || 1,
        xpValue || 10,
        ruleType || BADGE_RULES.ATTESTATION,
        ruleNote || "",
        minValue || 0,
        coinTypeStr || "",
        dappAddress || "",
        extraData || "",
        startsAt || 0,
        endsAt || 0,
        maxSupply || 0,
        mintFee ?? 0,
      ],
    },
  });
};

export const createBadgeMinBalance = async ({
  signAndSubmitTransaction,
  sender,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  category,
  rarity,
  xpValue,
  coinType,
  coinTypeStr,
  minBalance,
  ruleNote,
  startsAt,
  endsAt,
  maxSupply,
  mintFee,
}) => {
  const fn = getBadgeFunction("create_badge_min_balance");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [coinType],
      functionArguments: [
        name || "",
        description || "",
        imageUri || "",
        metadataUri || "",
        metadataHash || "",
        category || "activity",
        rarity || 1,
        xpValue || 10,
        coinTypeStr || "",
        minBalance || 0,
        ruleNote || "",
        startsAt || 0,
        endsAt || 0,
        maxSupply || 0,
        mintFee ?? 0,
      ],
    },
  });
};

// Legacy compat functions
export const createBadgeAllowlist = async ({
  signAndSubmitTransaction,
  sender,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  ruleType,
  ruleNote,
}) => {
  const fn = getBadgeFunction("create_badge_allowlist");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        name,
        description,
        imageUri,
        metadataUri,
        metadataHash,
        ruleType,
        ruleNote,
      ],
    },
  });
};

export const createBadgeTxCount = async ({
  signAndSubmitTransaction,
  sender,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  minTxCount,
  ruleNote,
}) => {
  const fn = getBadgeFunction("create_badge_tx_count");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        name,
        description,
        imageUri,
        metadataUri,
        metadataHash,
        minTxCount,
        ruleNote,
      ],
    },
  });
};

export const createBadgeProtocolCount = async ({
  signAndSubmitTransaction,
  sender,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  minProtocolCount,
  ruleNote,
}) => {
  const fn = getBadgeFunction("create_badge_protocol_count");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        name,
        description,
        imageUri,
        metadataUri,
        metadataHash,
        minProtocolCount,
        ruleNote,
      ],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS - Badge Lifecycle Management
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const pauseBadge = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
}) => {
  const fn = getBadgeFunction("pause_badge");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId],
    },
  });
};

export const resumeBadge = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
}) => {
  const fn = getBadgeFunction("resume_badge");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId],
    },
  });
};

export const discontinueBadge = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
}) => {
  const fn = getBadgeFunction("discontinue_badge");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId],
    },
  });
};

export const updateBadgeTimeLimits = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  startsAt,
  endsAt,
}) => {
  const fn = getBadgeFunction("update_badge_time_limits");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId, startsAt || 0, endsAt || 0],
    },
  });
};

export const updateBadgeMetadata = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  category,
  rarity,
  xpValue,
  ruleNote,
}) => {
  const fn = getBadgeFunction("update_badge_metadata");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        badgeId,
        name || "",
        description || "",
        imageUri || "",
        metadataUri || "",
        metadataHash || "",
        category || "activity",
        rarity || 1,
        xpValue || 10,
        ruleNote || "",
      ],
    },
  });
};

export const updateBadgeRule = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  minValue,
  dappAddress,
  extraData,
}) => {
  const fn = getBadgeFunction("update_badge_rule");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [
        badgeId,
        minValue || 0,
        dappAddress || "",
        extraData || "",
      ],
    },
  });
};

export const updateBadgeMaxSupply = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  maxSupply,
}) => {
  const fn = getBadgeFunction("update_badge_max_supply");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId, maxSupply || 0],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS - Allowlist Management

export const updateBadgeFee = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  newFee,
}) => {
  const fn = getBadgeFunction("update_badge_fee");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId, newFee ?? 0],
    },
  });
};

export const setFeeTreasury = async ({
  signAndSubmitTransaction,
  sender,
  newTreasury,
}) => {
  const fn = getBadgeFunction("set_fee_treasury");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [newTreasury],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS - Allowlist Management
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const addAllowlistEntries = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  addresses,
}) => {
  const fn = getBadgeFunction("add_allowlist_entries");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId, addresses],
    },
  });
};

export const removeAllowlistEntries = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  addresses,
}) => {
  const fn = getBadgeFunction("remove_allowlist_entries");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId, addresses],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// USER FUNCTIONS - Badge Minting
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const mintBadge = async ({
  client,
  signAndSubmitTransaction,
  sender,
  badgeId,
  badge: _badge,
}) => {
  const fn = getBadgeFunction("mint");
  if (!fn) throw new Error("Badge module address not configured");

  if (client) {
    const alreadyOwned = await hasBadge(client, badgeId, sender);
    if (alreadyOwned) throw new Error("You already own this badge");
  }

  const result = await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId],
    },
  });

  return result;
};

export const mintBadgeWithBalance = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  coinType,
  badge: _badge,
}) => {
  const fn = getBadgeFunction("mint_with_balance");
  if (!fn) throw new Error("Badge module address not configured");

  const result = await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [coinType],
      functionArguments: [badgeId],
    },
  });

  return result;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const ruleLabel = (ruleType) => {
  return getRuleLabel(ruleType);
};

// Check if badge is currently available for minting
export const isBadgeMintable = (badge, now = Date.now() / 1000) => {
  if (!badge) return false;
  if (badge.status !== BADGE_STATUS.ACTIVE) return false;
  if (badge.startsAt > 0 && now < badge.startsAt) return false;
  if (badge.endsAt > 0 && now > badge.endsAt) return false;
  if (badge.maxSupply > 0 && badge.totalMinted >= badge.maxSupply) return false;
  return true;
};

// Get time remaining for time-limited badge
export const getBadgeTimeRemaining = (badge, now = Date.now() / 1000) => {
  if (!badge || !badge.endsAt || badge.endsAt === 0) return null;
  const remaining = badge.endsAt - now;
  if (remaining <= 0) return { expired: true, remaining: 0 };
  
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  
  return {
    expired: false,
    remaining,
    days,
    hours,
    minutes,
    formatted: days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
  };
};

// Get supply info
export const getBadgeSupplyInfo = (badge) => {
  if (!badge || !badge.maxSupply || badge.maxSupply === 0) {
    return { unlimited: true, remaining: null, percentage: 0 };
  }
  
  const remaining = badge.maxSupply - badge.totalMinted;
  const percentage = (badge.totalMinted / badge.maxSupply) * 100;
  
  return {
    unlimited: false,
    remaining,
    percentage: Math.min(100, percentage),
    soldOut: remaining <= 0,
  };
};
