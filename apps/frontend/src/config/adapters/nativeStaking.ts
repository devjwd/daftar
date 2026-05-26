// src/config/adapters/nativeStaking.js
// Movement Native Staking (Framework delegation pool)
import { queryIndexer } from "../../services/indexer";
import { resolveTokenPrice } from "../../utils/price";

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

const VALIDATOR_NAMES: Record<string, string> = {
  "0x1ef54ef84e7fb389095f83021755dd71bb51cbfbc8124a4349ec619f9d901f1f": "Apollo",
  "0x830bfd0cd58b06dc938d409b6f3bc8ee97818ffcf9b32d714c068454afb644c7": "Hephaestus",
  "0x39f116ee9ef048895bff51a5ce62229d153a6fe855798fa75810fd2b85008b9c": "Artemis",
  "0xccba2d929183a642f64d10d27bae0947c112ed7f5427ca3c64a1f0dd0b4b76ea": "Hermes",
};

export const nativeStakingAdapter = [
  {
    id: "movement_native_staking",
    name: "Movement Native Staking",
    type: "Staking",
    searchString: "::delegation_pool::",
    filterType: (typeString) => String(typeString || "").toLowerCase().startsWith("0x1::delegation_pool::"),
    parse: parseDelegationPoolStake,
    discover: async ({ client, targetAddress, priceMap }) => {
      const positions = [];
      const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
      const poolAddresses = new Set<string>();

      try {
        const query = `
          query GetDelegatorStake($address: String!) {
            current_delegator_balances(
              where: {
                delegator_address: { _eq: $address }
              }
            ) {
              pool_address
            }
          }
        `;
        const data = await queryIndexer(query, { address: targetAddress.toString() });
        const balances = data?.current_delegator_balances || [];
        for (const bal of balances) {
          if (bal.pool_address) {
            poolAddresses.add(bal.pool_address.toLowerCase().trim());
          }
        }
      } catch (err) {
        console.warn("Indexer delegator stake fetch failed, trying view function fallback:", err);
      }

      // Fallback to ValidatorSet resource if indexer returned nothing
      if (poolAddresses.size === 0 && client) {
        try {
          const validatorSet = await client.getAccountResource({
            accountAddress: "0x1",
            resourceType: "0x1::stake::ValidatorSet"
          });
          const activeValidators = (validatorSet as any)?.active_validators || [];
          for (const val of activeValidators) {
            if (val.addr) {
              poolAddresses.add(val.addr.toLowerCase().trim());
            }
          }
        } catch (e) {
          console.warn("Failed to fetch validator set resource:", e);
        }
      }

      // Query get_stake view function for each pool address
      if (client && poolAddresses.size > 0) {
        for (const poolAddress of poolAddresses) {
          try {
            const stakeRes = await client.view({
              payload: {
                function: "0x1::delegation_pool::get_stake",
                typeArguments: [],
                functionArguments: [poolAddress, targetAddress.toString()]
              }
            });

            if (Array.isArray(stakeRes) && stakeRes.length >= 3) {
              const active = BigInt(stakeRes[0]);
              const inactive = BigInt(stakeRes[1]);
              const pendingInactive = BigInt(stakeRes[2]);
              const totalRaw = active + inactive + pendingInactive;

              if (totalRaw > 0n) {
                let lockedUntilSecs = 0;
                try {
                  const stakePool = await client.getAccountResource({
                    accountAddress: poolAddress,
                    resourceType: "0x1::stake::StakePool"
                  });
                  lockedUntilSecs = Number((stakePool as any)?.locked_until_secs || 0);
                } catch (e) {
                  console.warn(`Failed to fetch StakePool resource for ${poolAddress}:`, e);
                }

                const amount = Number(totalRaw) / 1e8;
                const validatorName = VALIDATOR_NAMES[poolAddress] || "Native Stake Pool";
                positions.push({
                  id: `native_staking_${poolAddress}`,
                  protocol: "movement",
                  protocolName: "Movement Native Staking",
                  protocolWebsite: "https://staking.movementnetwork.xyz/",
                  symbol: "MOVE",
                  name: validatorName,
                  poolAddress: poolAddress,
                  amount: amount,
                  numericValue: amount * movePrice,
                  value: amount.toFixed(4),
                  usdValue: amount * movePrice,
                  type: "Staking",
                  source: "view",
                  lockedUntilSecs: lockedUntilSecs,
                  pendingStakeAmount: 0n.toString(),
                  pendingWithdrawalAmount: pendingInactive.toString(),
                  details: {
                    active: Number(active) / 1e8,
                    inactive: Number(inactive) / 1e8,
                    pendingActive: 0,
                    pendingInactive: Number(pendingInactive) / 1e8,
                  }
                });
              }
            }
          } catch (err) {
            // ignore individual pool errors
          }
        }
      }

      return positions;
    }
  },
];

