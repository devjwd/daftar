/**
 * =============================================================================
 * Mosaic Swap Service
 * =============================================================================
 *
 * This module provides settings normalization, slippage helpers, and
 * direct Mosaic quote/payload helpers for the swap component.
 */

import { MOSAIC_CONFIG } from "../config/network";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SLIPPAGE_PERCENT = 0.5;
const MIN_SLIPPAGE_PERCENT = 0.01;
const MAX_SLIPPAGE_PERCENT = 50;
const MAX_FEE_BPS = 500; // 5% max protocol fee
const QUOTE_TIMEOUT_MS = 8000;
const VALID_ROUTING_MODES = ["mosaic"];
const DEFAULT_ENABLED_LIQUIDITY_SOURCES = ["mosaic_amm"];

const KNOWN_MOSAIC_ASSETS = {
  MOVE: "0xa",
  USDC: "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39",
  USDT: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d",
  WETH: "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376",
  WBTC: "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c",
};

const SYMBOL_ALIASES = {
  ETH: "WETH",
  BTC: "WBTC",
};

let registryCache = null;
let registryFetchedAt = 0;
const REGISTRY_TTL_MS = 5 * 60 * 1000;

const DECIMAL_INPUT_PATTERN = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const toSafeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeSourceIds = (value) => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_LIQUIDITY_SOURCES];
  }

  const ids = value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  return ids.length > 0 ? Array.from(new Set(ids)) : [...DEFAULT_ENABLED_LIQUIDITY_SOURCES];
};

/**
 * Clamp slippage to a safe range [0.01%, 50%].
 * @param {number|string} value - Raw slippage input
 * @returns {number} Clamped slippage percentage
 */
export const clampSlippagePercent = (value) => {
  const numeric = toSafeNumber(value, DEFAULT_SLIPPAGE_PERCENT);
  return Math.max(MIN_SLIPPAGE_PERCENT, Math.min(MAX_SLIPPAGE_PERCENT, numeric));
};

/**
 * Convert a slippage percentage to basis points.
 * @param {number} percent - Slippage percentage (e.g. 0.5 → 50 bps)
 * @returns {number} Basis points
 */
export const slippageToBps = (percent) => {
  return Math.round(clampSlippagePercent(percent) * 100);
};

// ---------------------------------------------------------------------------
// Settings Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize raw admin swap settings into a consistent shape.
 *
 * @param {Object} rawSettings - Raw settings from adminService
 * @returns {Object} Normalized settings object
 */
export const normalizeMosaicSwapSettings = (rawSettings = {}) => {
  const feeInBpsRaw = rawSettings.feeInBps ?? rawSettings.protocolFeeBps ?? 0;
  const feeInBps = Math.max(0, Math.min(MAX_FEE_BPS, Math.round(toSafeNumber(feeInBpsRaw, 0))));

  const feeReceiver = String(rawSettings.feeReceiver ?? rawSettings.referrer ?? "").trim();
  const defaultSlippagePercent = clampSlippagePercent(
    rawSettings.defaultSlippagePercent ?? DEFAULT_SLIPPAGE_PERCENT
  );

  const isFeeIn = Boolean(rawSettings.isFeeIn ?? true);
  const mosaicApiKey = String(rawSettings.mosaicApiKey || "").trim();

  const routingMode = String(rawSettings.routingMode || "mosaic").toLowerCase();
  const normalizedRoutingMode = VALID_ROUTING_MODES.includes(routingMode) ? routingMode : "mosaic";

  const enabledLiquiditySources = normalizeSourceIds(rawSettings.enabledLiquiditySources);

  return {
    feeInBps,
    feeReceiver,
    isFeeIn,
    defaultSlippagePercent,
    mosaicApiKey,
    routingMode: normalizedRoutingMode,
    enabledLiquiditySources,
  };
};

const normalizeSymbol = (symbol) => {
  const raw = String(symbol || "").trim().toUpperCase().replace(/\.E$/i, "");
  return SYMBOL_ALIASES[raw] || raw;
};

const normalizeAddress = (address) => {
  const raw = String(address || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("::") ? raw.split("::")[0] : raw;
};

const normalizeAmountString = (value) => {
  const raw = String(value || "").trim();
  if (!DECIMAL_INPUT_PATTERN.test(raw)) return null;
  return raw;
};

const baseUnitsToDecimalString = (rawValue, decimals = 8, precision = 8) => {
  const raw = String(rawValue || "0").trim();
  if (!/^\d+$/.test(raw)) return "0";

  const normalizedDecimals = Math.max(0, Math.min(18, Number(decimals) || 0));
  const padded = raw.padStart(normalizedDecimals + 1, "0");
  const point = padded.length - normalizedDecimals;

  const wholePart = padded.slice(0, point).replace(/^0+(?=\d)/, "");
  const fractionPart = padded.slice(point);
  const displayedFraction = fractionPart.slice(0, Math.max(0, precision));
  const trimmedFraction = displayedFraction.replace(/0+$/, "");

  return trimmedFraction.length > 0 ? `${wholePart}.${trimmedFraction}` : wholePart;
};

async function fetchTokenRegistry(apiKey = "") {
  const now = Date.now();
  if (registryCache && now - registryFetchedAt < REGISTRY_TTL_MS) {
    return registryCache;
  }

  const headers = { Accept: "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const response = await fetch(`${MOSAIC_CONFIG.apiUrl}/tokens`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Token registry fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const tokens = payload?.data || payload || [];

  const bySymbol = new Map();
  const byAddress = new Map();

  for (const token of tokens) {
    const symbol = normalizeSymbol(token.symbol);
    const address = normalizeAddress(token.address || token.id);
    if (!address) continue;
    if (symbol && !bySymbol.has(symbol)) bySymbol.set(symbol, address);
    byAddress.set(address, address);
  }

  registryCache = { bySymbol, byAddress };
  registryFetchedAt = now;
  return registryCache;
}

async function resolveTokenId(token, apiKey = "") {
  if (!token) return null;

  const symbol = normalizeSymbol(token.symbol);
  const address = normalizeAddress(token.address || token.fullType);

  try {
    const registry = await fetchTokenRegistry(apiKey);
    if (registry.bySymbol.has(symbol)) return registry.bySymbol.get(symbol);
    if (address && registry.byAddress.has(address)) return address;
  } catch {
    // fall through to known assets / raw address
  }

  if (KNOWN_MOSAIC_ASSETS[symbol]) return KNOWN_MOSAIC_ASSETS[symbol];
  return address || null;
}

export const fetchMosaicQuote = async ({
  fromToken,
  toToken,
  amount,
  sender,
  slippageBps,
  settings = {},
  signal,
}) => {
  const apiKey = String(settings.mosaicApiKey || "").trim();
  const srcAsset = await resolveTokenId(fromToken, apiKey);
  const dstAsset = await resolveTokenId(toToken, apiKey);

  if (!srcAsset || !dstAsset) {
    return { best: null, selectedSource: "none", error: "Unable to resolve token IDs" };
  }

  const normalizedAmount = normalizeAmountString(amount);
  if (!normalizedAmount || normalizedAmount === "0") {
    return { best: null, selectedSource: "none", error: "Invalid swap amount" };
  }

  const params = new URLSearchParams({
    srcAsset,
    dstAsset,
    amount: normalizedAmount,
    sender,
    receiver: sender,
    slippage: String(slippageBps),
    source: "mosaic_amm",
  });

  const feeBps = Number(settings.feeInBps || 0);
  if (feeBps > 0) {
    params.set("feeInBps", String(feeBps));
    params.set("isFeeIn", String(settings.isFeeIn ?? true));
    if (settings.feeReceiver) params.set("feeReceiver", settings.feeReceiver);
  }

  const headers = { Accept: "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const response = await fetch(`${MOSAIC_CONFIG.apiUrl}/quote?${params.toString()}`, {
    method: "GET",
    headers,
    signal,
  });

  if (!response.ok) {
    return { best: null, selectedSource: "none", error: `Mosaic API ${response.status}` };
  }

  const payload = await response.json();
  const data = payload?.data || payload;
  if (!data?.dstAmount) {
    return { best: null, selectedSource: "none", error: "Invalid quote response" };
  }

  const toDecimals = Number(toToken?.decimals) || 8;
  const outputRaw = String(data.dstAmount);
  const outputDisplayAmount = baseUnitsToDecimalString(outputRaw, toDecimals, 8);
  const outputAmount = Number(outputDisplayAmount);
  const srcAmountRaw = String(data.srcAmount || normalizedAmount);

  return {
    best: {
      source: "mosaic",
      sourceLabel: "Mosaic AMM",
      outputAmount,
      outputRaw,
      outputDisplayAmount,
      requestedAmountRaw: normalizedAmount,
      srcAmountRaw,
      srcAsset,
      dstAsset,
      quotedAt: Date.now(),
      quoteData: data,
      priceImpact: Number(data.priceImpact) || 0,
      hasTxPayload: Boolean(
        data.tx?.function && Array.isArray(data.tx?.typeArguments) && Array.isArray(data.tx?.functionArguments)
      ),
    },
    selectedSource: "mosaic",
    error: null,
  };
};

export const buildMosaicSwapPayload = (quoteData) => {
  if (!quoteData?.tx) return null;
  const tx = quoteData.tx;
  if (!tx.function || !Array.isArray(tx.typeArguments) || !Array.isArray(tx.functionArguments)) {
    return null;
  }

  return {
    function: tx.function,
    typeArguments: tx.typeArguments,
    functionArguments: tx.functionArguments,
  };
};
