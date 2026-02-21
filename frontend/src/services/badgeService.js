import { getBadgeFunction, BADGE_RULES, getRuleLabel } from "../config/badges";

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
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const fetchBadgeIds = async (client) => {
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
};

export const fetchBadge = async (client, badgeId) => {
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
    ruleType,
    ruleNote,
    minBalance,
    coinTypeStr,
    createdAt,
    updatedAt,
  ] = result;

  return {
    id: Number(id),
    name: decodeBytes(name),
    description: decodeBytes(description),
    imageUri: decodeBytes(imageUri),
    metadataUri: decodeBytes(metadataUri),
    metadataHash: decodeBytes(metadataHash),
    ruleType: Number(ruleType),
    ruleNote: decodeBytes(ruleNote),
    minBalance: Number(minBalance),
    coinTypeStr: decodeBytes(coinTypeStr),
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt),
  };
};

export const fetchBadges = async (client) => {
  const ids = await fetchBadgeIds(client);
  const badges = [];

  for (const badgeId of ids) {
    const badge = await fetchBadge(client, badgeId);
    if (badge) badges.push(badge);
  }

  return badges;
};

export const hasBadge = async (client, badgeId, owner) => {
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
};

export const isAllowlisted = async (client, badgeId, owner) => {
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
};

export const getCoinBalance = async (client, owner, coinType) => {
  if (!coinType) return 0;

  const result = await client.view({
    payload: {
      function: "0x1::coin::balance",
      typeArguments: [coinType],
      functionArguments: [owner],
    },
  });

  return Number(result && result[0]) || 0;
};

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

export const createBadgeMinBalance = async ({
  signAndSubmitTransaction,
  sender,
  name,
  description,
  imageUri,
  metadataUri,
  metadataHash,
  coinType,
  coinTypeStr,
  minBalance,
  ruleNote,
}) => {
  const fn = getBadgeFunction("create_badge_min_balance");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [coinType],
      functionArguments: [
        name,
        description,
        imageUri,
        metadataUri,
        metadataHash,
        coinTypeStr,
        minBalance,
        ruleNote,
      ],
    },
  });
};

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

export const mintBadge = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
}) => {
  const fn = getBadgeFunction("mint");
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

export const mintBadgeWithBalance = async ({
  signAndSubmitTransaction,
  sender,
  badgeId,
  coinType,
}) => {
  const fn = getBadgeFunction("mint_with_balance");
  if (!fn) throw new Error("Badge module address not configured");

  return await signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [coinType],
      functionArguments: [badgeId],
    },
  });
};

export const ruleLabel = (ruleType) => {
  return getRuleLabel(ruleType);
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
