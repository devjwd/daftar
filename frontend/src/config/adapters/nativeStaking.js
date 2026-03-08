// src/config/adapters/nativeStaking.js
// Movement Native Staking (Framework delegation pool)

const MOVE_DECIMALS = 8n;
const DISPLAY_DECIMALS = 4n;
const DISPLAY_DIVISOR = 10n ** (MOVE_DECIMALS - DISPLAY_DECIMALS);

const toPositiveBigInt = (value) => {
  if (value === null || value === undefined) return 0n;

  if (typeof value === "bigint") {
    return value > 0n ? value : 0n;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.floor(value));
  }

  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) return 0n;
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  }

  if (typeof value === "object") {
    if (value.value !== undefined) return toPositiveBigInt(value.value);
    if (value.amount !== undefined) return toPositiveBigInt(value.amount);
    if (value.coin !== undefined) return toPositiveBigInt(value.coin);
  }

  return 0n;
};

const collectByFields = (node, fields, depth = 0, maxDepth = 8) => {
  if (!node || depth > maxDepth) return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectByFields(item, fields, depth + 1, maxDepth));
  }

  if (typeof node !== "object") return [];

  const found = [];

  for (const [key, value] of Object.entries(node)) {
    if (fields.has(key)) {
      const parsed = toPositiveBigInt(value);
      if (parsed > 0n) {
        found.push(parsed);
      }
    }

    if (value && typeof value === "object") {
      found.push(...collectByFields(value, fields, depth + 1, maxDepth));
    }
  }

  return found;
};

const pickLargest = (values) => {
  if (!values.length) return 0n;
  return values.reduce((largest, current) => (current > largest ? current : largest), 0n);
};

const formatMove = (rawAmount) => {
  if (!rawAmount || rawAmount <= 0n) return "0";

  const whole = rawAmount / (10n ** MOVE_DECIMALS);
  const fraction4 = (rawAmount % (10n ** MOVE_DECIMALS)) / DISPLAY_DIVISOR;
  return `${whole.toString()}.${fraction4.toString().padStart(Number(DISPLAY_DECIMALS), "0")}`;
};

const parseDelegationPoolStake = (data) => {
  if (Array.isArray(data) && data.length >= 3) {
    const active = toPositiveBigInt(data[0]);
    const inactive = toPositiveBigInt(data[1]);
    const pendingActive = toPositiveBigInt(data[2]);
    const pendingWithdrawal = toPositiveBigInt(data[3]);

    const tupleTotal = active + inactive + pendingActive + pendingWithdrawal;
    return formatMove(tupleTotal);
  }

  const primaryFields = new Set([
    "active",
    "active_stake",
    "active_staked",
    "principal",
    "stake",
    "staked",
    "staked_amount",
    "total_stake",
    "delegated",
    "delegated_amount",
    "amount",
  ]);

  const pendingFields = new Set([
    "pending_active",
    "pending_inactive",
    "pending_withdraw",
    "pending_withdrawal",
  ]);

  const activeValues = collectByFields(data, primaryFields);
  const pendingValues = collectByFields(data, pendingFields);

  const activeRaw = pickLargest(activeValues);
  const pendingRaw = pendingValues.reduce((sum, current) => sum + current, 0n);
  const totalRaw = activeRaw + pendingRaw;

  return formatMove(totalRaw);
};

export const nativeStakingAdapter = [
  {
    id: "movement_native_staking",
    name: "Movement Native Staking",
    type: "Staking",
    searchString: "::delegation_pool::",
    filterType: (typeString) => String(typeString || "").toLowerCase().startsWith("0x1::delegation_pool::"),
    parse: parseDelegationPoolStake,
  },
];
