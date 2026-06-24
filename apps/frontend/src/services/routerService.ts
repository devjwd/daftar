import { SWAP_ROUTER_ADDRESS } from '../config/network';

import { normalizeAddress } from '../utils/address';

const normalizeChargeFeeBy = (value: any): 'token_in' | 'token_out' => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'token_out' ? 'token_out' : 'token_in';
};

const toPercent = (bps) => Number(bps || 0) / 100;
const toBps = (percent) => Math.round(Number(percent || 0) * 100);

const getRouterFunction = (name) => {
  const routerAddress = normalizeAddress(SWAP_ROUTER_ADDRESS);
  if (!routerAddress) return null;
  return `${routerAddress}::router::${name}`;
};

export const isRouterConfigured = () => Boolean(normalizeAddress(SWAP_ROUTER_ADDRESS));

export const fetchRouterPartnerConfig = async (client) => {
  const fn = getRouterFunction('get_partner_config');
  if (!client || !fn) {
    throw new Error('Swap router address is not configured');
  }

  const result = await client.view({
    payload: {
      function: fn,
      typeArguments: [],
      functionArguments: [],
    },
  });

  if (!Array.isArray(result) || result.length < 5) {
    throw new Error('Unexpected router config response');
  }

  const [feeBps, feeTreasury, chargeFeeBy, defaultSlippageBps, paused] = result;

  return {
    feeInBps: Number(feeBps || 0),
    feeReceiver: String(feeTreasury || ''),
    chargeFeeBy: normalizeChargeFeeBy(chargeFeeBy),
    defaultSlippagePercent: toPercent(defaultSlippageBps),
    paused: Boolean(paused),
  };
};

const submitRouterTx = async ({ signAndSubmitTransaction, sender, functionName, functionArguments }) => {
  const fn = getRouterFunction(functionName);
  if (!fn) throw new Error('Swap router address is not configured');

  return signAndSubmitTransaction({
    sender,
    data: {
      function: fn,
      typeArguments: [],
      functionArguments,
    },
  });
};

export const updateRouterFee = async ({ signAndSubmitTransaction, sender, feeInBps }) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'update_fee',
    functionArguments: [Number(feeInBps || 0)],
  });
};

export const updateRouterTreasury = async ({ signAndSubmitTransaction, sender, feeReceiver }) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'update_treasury',
    functionArguments: [normalizeAddress(feeReceiver)],
  });
};

export const updateRouterChargeFeeBy = async ({ signAndSubmitTransaction, sender, chargeFeeBy }) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'update_charge_fee_by',
    functionArguments: [normalizeChargeFeeBy(chargeFeeBy)],
  });
};

export const updateRouterDefaultSlippage = async ({ signAndSubmitTransaction, sender, defaultSlippagePercent }) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'update_default_slippage',
    functionArguments: [toBps(defaultSlippagePercent)],
  });
};

export const setRouterPaused = async ({ signAndSubmitTransaction, sender, paused }) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'set_paused',
    functionArguments: [Boolean(paused)],
  });
};

// ---------------------------------------------------------------------------
// Analytics — added after audit remediation (record_swap, get_stats, get_min_record_interval)
// ---------------------------------------------------------------------------

/**
 * Call router::record_swap on-chain after a confirmed Mosaic/Yuzu swap.
 * This is fire-and-forget analytics; failures must NOT block the UX flow.
 *
 * @param amountIn     - input amount in base units (u64 as number)
 * @param feeReported  - fee amount from the Mosaic quote (u64 as number)
 * @param routerSource - route_id: 1 = Mosaic, 2+ = future routes (u8 as number)
 */
export const recordOnChainSwap = async ({
  signAndSubmitTransaction,
  sender,
  amountIn,
  feeReported,
  routerSource = 1,
}) => {
  return submitRouterTx({
    signAndSubmitTransaction,
    sender,
    functionName: 'record_swap',
    functionArguments: [
      Number(amountIn) || 0,
      Number(feeReported) || 0,
      Number(routerSource) || 1,
    ],
  });
};

/**
 * Fetch global swap analytics counters (self-reported, informational only).
 * Returns { totalSwaps, totalFeesReported }.
 */
export const fetchRouterStats = async (client) => {
  const fn = getRouterFunction('get_stats');
  if (!client || !fn) return null;

  try {
    const result = await client.view({
      payload: { function: fn, typeArguments: [], functionArguments: [] },
    });
    if (!Array.isArray(result) || result.length < 2) return null;
    return {
      totalSwaps: Number(result[0] || 0),
      totalFeesReported: Number(result[1] || 0),
    };
  } catch {
    return null;
  }
};

/**
 * Fetch the minimum seconds between consecutive record_swap calls per address.
 * Returns the cooldown in seconds (default 1), or null if the router is not configured.
 */
export const fetchRouterMinRecordInterval = async (client) => {
  const fn = getRouterFunction('get_min_record_interval');
  if (!client || !fn) return null;

  try {
    const result = await client.view({
      payload: { function: fn, typeArguments: [], functionArguments: [] },
    });
    return Array.isArray(result) && result.length > 0 ? Number(result[0]) : null;
  } catch {
    return null;
  }
};

