import { SWAP_ROUTER_ADDRESS } from '../config/network';

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const normalizeChargeFeeBy = (value) => {
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
