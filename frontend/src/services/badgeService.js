import { getBadgeFunction, getBadgeModuleAddress, BADGE_RULES, BADGE_STATUS, getRuleLabel } from "../config/badges";

const normalizeAddress = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
};

const getRegistryResourceType = () => {
  const moduleAddress = normalizeAddress(getBadgeModuleAddress());
  if (!moduleAddress) return null;
  return `${moduleAddress}::badges::BadgeRegistry`;
};

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
    const moduleAddress = normalizeAddress(getBadgeModuleAddress());
    const resourceType = getRegistryResourceType();
    if (!moduleAddress || !resourceType) return [];

    const resource = await client.getAccountResource({
      accountAddress: moduleAddress,
      resourceType,
    });

    const rawIds = resource?.badge_ids || resource?.data?.badge_ids || [];
    return Array.isArray(rawIds) ? rawIds.map((id) => Number(id)).filter(Number.isFinite) : [];
  } catch (error) {
    console.error('[badgeService] fetchBadgeIds failed:', error.message);
    return [];
  }
};

export const fetchActiveBadgeIds = async (client) => {
  try {
    const ids = await fetchBadgeIds(client);
    const details = await Promise.all(ids.map((badgeId) => fetchBadge(client, badgeId)));
    return details
      .filter((badge) => badge && badge.status === BADGE_STATUS.ACTIVE)
      .map((badge) => badge.id);
  } catch (error) {
    console.error('[badgeService] fetchActiveBadgeIds failed:', error.message);
    return [];
  }
};

export const fetchBadge = async (client, badgeId) => {
  try {
    const fn = getBadgeFunction("get_badge_info");
    if (!fn) return null;

    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [badgeId],
      },
    });

    if (!result) return null;

    const [name, category, status, mintFee, totalMinted, maxSupply, xpValue, startsAt, endsAt] = result;

    return {
      id: Number(badgeId),
      name: decodeBytes(name),
      description: '',
      imageUri: '',
      metadataUri: '',
      metadataHash: '',
      category: decodeBytes(category),
      rarity: 1,
      xpValue: Number(xpValue),
      ruleType: BADGE_RULES.ATTESTATION,
      ruleNote: 'offchain_signature',
      minValue: 0,
      coinTypeStr: '',
      dappAddress: '',
      status: Number(status),
      startsAt: Number(startsAt),
      endsAt: Number(endsAt),
      createdAt: 0,
      updatedAt: 0,
      mintFee: Number(mintFee),
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
  void client;
  void badgeId;
  void owner;
  // Removed in the new contract architecture.
  return false;
};

// Note: is_badge_available does not exist as a contract view function.
// Computed client-side from get_badge_info results via isBadgeMintable.
export const isBadgeAvailable = async (client, badgeId) => {
  try {
    const badge = await fetchBadge(client, badgeId);
    return badge ? isBadgeMintable(badge) : false;
  } catch (error) {
    console.error('[badgeService] isBadgeAvailable failed:', error.message);
    return false;
  }
};

// Note: get_badge_stats does not exist as a contract view function.
// Derived from get_badge_info results via fetchBadge.
export const getBadgeStats = async (client, badgeId) => {
  try {
    const badge = await fetchBadge(client, badgeId);
    if (!badge) return { totalMinted: 0, maxSupply: 0, status: BADGE_STATUS.ACTIVE };
    return {
      totalMinted: badge.totalMinted,
      maxSupply: badge.maxSupply,
      status: badge.status,
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

// Note: get_admin does not exist as a contract view function.
// Derived from get_registry_info via fetchRegistryInfo.
export const getAdmin = async (client) => {
  try {
    const info = await fetchRegistryInfo(client);
    return info?.admin || null;
  } catch (error) {
    console.error('[badgeService] getAdmin failed:', error.message);
    return null;
  }
};

// Note: get_badge_fee does not exist as a contract view function.
// Derived from get_badge_info results via fetchBadge.
export const getBadgeFee = async (client, badgeId) => {
  try {
    const badge = await fetchBadge(client, badgeId);
    return badge?.mintFee || 0;
  } catch (error) {
    console.error('[badgeService] getBadgeFee failed:', error.message);
    return 0;
  }
};

// Note: get_fee_treasury does not exist as a contract view function.
// Derived from get_registry_info via fetchRegistryInfo.
export const getFeeTreasury = async (client) => {
  try {
    const info = await fetchRegistryInfo(client);
    return info?.feeTreasury || null;
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
  category,
  rarity,
  xpValue,
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
        category || "activity",
        rarity || 1,
        xpValue || 10,
        startsAt || 0,
        endsAt || 0,
        maxSupply || 0,
        mintFee ?? 0,
      ],
    },
  });
};

/**
 * waitForTxAndGetId
 * 
 * Waits for a transaction result and parses the BadgeCreatedEvent to get the u64 ID.
 */
export const waitForTxAndGetId = async (client, txHash) => {
  if (!client || !txHash) return null;

  try {
    const tx = await client.waitForTransaction({ transactionHash: txHash });
    if (!tx || tx.type !== 'user_transaction' || !tx.success) {
      throw new Error(`Transaction failed or not found: ${txHash}`);
    }

    const moduleAddress = normalizeAddress(getBadgeModuleAddress());
    const eventType = `${moduleAddress}::badges::BadgeCreatedEvent`;

    const event = tx.events?.find(e => e.type === eventType);
    if (!event) {
      console.warn('[badgeService] BadgeCreatedEvent not found in tx:', txHash);
      return null;
    }

    // In Aptos/Movement events, data usually contains the fields
    return Number(event.data?.badge_id ?? event.data?.id ?? null);
  } catch (err) {
    console.error('[badgeService] waitForTxAndGetId error:', err);
    throw err;
  }
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
  return signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [badgeId],
    },
  });
};

// Note: updateBadgeTimeLimits, updateBadgeMetadata, updateBadgeRule, updateBadgeMaxSupply, updateBadgeFee, addAllowlistEntries and removeAllowlistEntries 
// were removed as they are no longer supported by the soulbound-signature-based contract architecture.

export const setFeeTreasury = async ({
  signAndSubmitTransaction,
  sender,
  newTreasury,
}) => {
  const fn = getBadgeFunction("update_fee_treasury");
  if (!fn) throw new Error("Badge module address not configured");
  return signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [newTreasury],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// USER FUNCTIONS - Badge Minting

// ═══════════════════════════════════════════════════════════════════════════════════════════
// USER FUNCTIONS - Badge Minting
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const mintBadge = async ({
  client,
  signAndSubmitTransaction,
  sender,
  badgeId,
  signatureBytes,
  validUntil,
  badge: _badge,
}) => {
  const fn = getBadgeFunction("mint");
  if (!fn) throw new Error("Badge module address not configured");

  if (!Array.isArray(signatureBytes) || signatureBytes.length !== 64) {
    throw new Error("A valid 64-byte mint signature is required");
  }

  if (client) {
    const alreadyOwned = await hasBadge(client, badgeId, sender);
    if (alreadyOwned) throw new Error("You already own this badge");
  }

  const result = await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      // Contract: mint(user, badge_id: u64, valid_until: u64, signature_bytes: vector<u8>)
      functionArguments: [badgeId, validUntil, new Uint8Array(signatureBytes)],
    },
  });

  return result;
};

// mintBadgeWithBalance removed. Use mintBadge with signature.

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS - Registry Management
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const fetchRegistryInfo = async (client) => {
  try {
    const moduleAddress = normalizeAddress(getBadgeModuleAddress());
    if (!moduleAddress) {
      console.warn('[badgeService] Badge module address is not configured in environment variables.');
      return { _error: 'CONFIG_MISSING' };
    }

    const resourceType = getRegistryResourceType();
    if (!resourceType) return null;

    const resource = await client.getAccountResource({
      accountAddress: moduleAddress,
      resourceType,
    });
    if (!resource) return null;

    const data = resource.data || resource;
    const signerPubKeyRaw = data.signer_pub_key;
    let signerPubKeyHex = '';
    if (Array.isArray(signerPubKeyRaw)) {
      signerPubKeyHex = signerPubKeyRaw.map(b => Number(b).toString(16).padStart(2, '0')).join('');
    } else if (typeof signerPubKeyRaw === 'string' && signerPubKeyRaw.startsWith('0x')) {
      signerPubKeyHex = signerPubKeyRaw.slice(2);
    } else if (typeof signerPubKeyRaw === 'string') {
      signerPubKeyHex = signerPubKeyRaw;
    }

    return {
      admin: String(data.admin || ''),
      pendingAdmin: String(data.pending_admin || ''),
      paused: Boolean(data.paused),
      feeTreasury: String(data.fee_treasury || ''),
      nextId: Number(data.next_id || 0),
      badgeCount: Array.isArray(data.badge_ids) ? data.badge_ids.length : 0,
      signerPubKeyHex,
    };
  } catch (error) {
    if (error.message?.includes('Resource not found')) {
      return { _error: 'NOT_INITIALIZED' };
    }
    console.error('[badgeService] fetchRegistryInfo failed:', error.message);
    return null;
  }
};

export const initializeRegistry = async ({ signAndSubmitTransaction, sender, signerPubKeyHex, feeTreasury }) => {
  const fn = getBadgeFunction('initialize');
  if (!fn) throw new Error('Badge module address not configured');

  const hex = signerPubKeyHex.startsWith('0x') ? signerPubKeyHex.slice(2) : signerPubKeyHex;
  if (hex.length !== 64) throw new Error('Ed25519 public key must be 64 hex chars');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [bytes, feeTreasury],
    },
  });
};

export const setGlobalPaused = async ({ signAndSubmitTransaction, sender, isPaused }) => {
  const fn = getBadgeFunction('set_paused');
  if (!fn) throw new Error('Badge module address not configured');

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [isPaused],
    },
  });
};

export const updateSignerPubKey = async ({ signAndSubmitTransaction, sender, newPubKeyHex }) => {
  const fn = getBadgeFunction('update_signer_pub_key');
  if (!fn) throw new Error('Badge module address not configured');

  const hex = newPubKeyHex.startsWith('0x') ? newPubKeyHex.slice(2) : newPubKeyHex;
  if (hex.length !== 64) throw new Error('Ed25519 public key must be 32 bytes (64 hex chars)');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [bytes],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const initiateAdminTransfer = async ({ signAndSubmitTransaction, sender, newAdmin }) => {
  const fn = getBadgeFunction('initiate_admin_transfer');
  if (!fn) throw new Error('Badge module address not configured');
  return signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [newAdmin],
    },
  });
};

export const acceptAdminTransfer = async ({ signAndSubmitTransaction, sender }) => {
  const fn = getBadgeFunction('accept_admin_transfer');
  if (!fn) throw new Error('Badge module address not configured');
  return signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments: [],
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// UTILITIES
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
