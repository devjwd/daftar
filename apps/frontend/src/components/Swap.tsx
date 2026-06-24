import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useMovementClient } from "../hooks/useMovementClient";
import { getSwapSettings, updateSwapSettings } from "../services/adminService";
import { fetchRouterPartnerConfig, isRouterConfigured, recordOnChainSwap } from "../services/routerService";
import { DEFAULT_NETWORK } from "../config/network";
import {
  clampSlippagePercent,
  normalizeMosaicSwapSettings,
  slippageToBps,
  fetchMosaicQuote,
  buildMosaicSwapPayload,
} from "../services/mosaicSwapService";
import { fetchYuzuQuote, buildYuzuSwapPayload } from "../services/yuzuSwapService";
import { getTokenDecimals } from "../utils/tokenUtils";
import { getTokenInfo, getSwapAssetTypeBySymbol, MOVEMENT_TOKENS } from "../config/tokens";
import { TOKEN_VISUALS } from "../config/display";
import { useTokenPrices } from "../hooks/useTokenPrices";

import { getStoredLanguagePreference, t } from "../utils/language";
import TransactionToast from "./TransactionToast";
import { WalletModal } from "./WalletModal";
import styles from './Swap.module.css';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SLIPPAGE = 0.5;
const DEFAULT_DECIMALS = 8;
const QUOTE_DEBOUNCE_MS = 600;
const AUTO_QUOTE_INTERVAL_MS = 10000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";
const QUOTE_MAX_AGE_MS = 30000;
const AMOUNT_INPUT_PATTERN = /^\d+(\.\d+)?$/;
const ALLOWED_MOSAIC_MODULES = new Set(["router"]);
const MAX_QUOTE_PRICE_IMPACT = 50;
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;
const TOAST_DISMISS_MS = 6500;
const SWAP_DETAILS_STORAGE_KEY = "movement_last_swap_details_v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};

const getWalletLogo = (name) => {
  if (!name) return null;
  const lowerName = name.toLowerCase();
  if (lowerName.includes('okx')) return '/okx.png';
  if (lowerName.includes('leap')) return '/leap.png';
  if (lowerName.includes('razor')) return '/razor.png';
  if (lowerName.includes('nightly')) return '/nightly.png';
  if (lowerName.includes('petra')) return '/logo.png';
  if (lowerName.includes('motion')) return '/motion.png';
  return null;
};

const normalizeTokenSymbol = (symbol) => {
  const normalized = String(symbol || "").trim().toUpperCase().replace(/\.E$/i, "");
  if (normalized === "ETH") return "WETH";
  if (normalized === "BTC") return "WBTC";
  return normalized;
};

const extractAddressFromType = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("::") ? raw.split("::")[0] : raw;
};

const formatUsd = (amount, price) => {
  const val = (parseFloat(amount) || 0) * (price || 0);
  if (val === 0) return "$0.00";
  
  if (val >= 1) {
    return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
};

const toBaseUnitsString = (amountStr, decimals = DEFAULT_DECIMALS) => {
  const normalized = String(amountStr || "").trim();
  if (!AMOUNT_INPUT_PATTERN.test(normalized)) return null;

  const safeDecimals = Math.max(0, Math.min(18, Number(decimals) || 0));
  const [wholeRaw, fractionalRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fractional = fractionalRaw.slice(0, safeDecimals).padEnd(safeDecimals, "0");
  const merged = `${whole}${fractional}`.replace(/^0+(?=\d)/, "");
  return merged.length > 0 ? merged : "0";
};

const isValidSwapPayload = (payload) => {
  if (!payload || typeof payload !== "object") return false;

  const fn = String(payload.function || "");
  if (!/^0x[0-9a-f]+::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/i.test(fn)) return false;
  if (!Array.isArray(payload.typeArguments) || !Array.isArray(payload.functionArguments)) return false;

  return true;
};

const parseFunctionId = (functionId) => {
  const match = String(functionId || "").trim().match(/^(0x[0-9a-f]+)::([A-Za-z0-9_]+)::([A-Za-z0-9_]+)$/i);
  if (!match) return null;
  return {
    address: match[1].toLowerCase(),
    module: match[2],
    functionName: match[3],
  };
};

const isAllowedMosaicPayload = (payload) => {
  const parsed = parseFunctionId(payload?.function);
  if (!parsed) return false;
  if (!ALLOWED_MOSAIC_MODULES.has(parsed.module)) return false;
  if (!String(parsed.functionName || "").toLowerCase().includes("swap")) return false;
  return true;
};

const deepEqualJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const collectAddressLikeValues = (value, output = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAddressLikeValues(entry, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectAddressLikeValues(entry, output));
    return output;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (ADDRESS_PATTERN.test(normalized)) {
      output.push(normalized);
    }
  }

  return output;
};

const isQuotePayloadConsistent = ({ payload, bestRoute, accountAddress, availableTokens }) => {
  const tx = bestRoute?.quoteData?.tx;
  if (!tx) {
    console.warn("[isQuotePayloadConsistent] Validation failed: tx is missing in bestRoute.quoteData", bestRoute);
    return false;
  }

  if (!deepEqualJson(payload.typeArguments, tx.typeArguments || [])) {
    console.warn("[isQuotePayloadConsistent] Validation failed: typeArguments mismatch", payload.typeArguments, tx.typeArguments);
    return false;
  }
  if (!deepEqualJson(payload.functionArguments, tx.functionArguments || [])) {
    console.warn("[isQuotePayloadConsistent] Validation failed: functionArguments mismatch", payload.functionArguments, tx.functionArguments);
    return false;
  }
  if (String(payload.function || "") !== String(tx.function || "")) {
    console.warn("[isQuotePayloadConsistent] Validation failed: function mismatch", payload.function, tx.function);
    return false;
  }

  const srcAmount = String(bestRoute?.quoteData?.srcAmount || "");
  const requestedAmount = String(bestRoute?.requestedAmountRaw || "");
  if (srcAmount && requestedAmount && srcAmount !== requestedAmount) {
    console.warn("[isQuotePayloadConsistent] Validation failed: srcAmount mismatch", srcAmount, requestedAmount);
    return false;
  }

  if (!bestRoute?.srcAsset || !bestRoute?.dstAsset) {
    console.warn("[isQuotePayloadConsistent] Validation failed: missing srcAsset or dstAsset", bestRoute);
    return false;
  }
  if (String(bestRoute.srcAsset).toLowerCase() === String(bestRoute.dstAsset).toLowerCase()) {
    console.warn("[isQuotePayloadConsistent] Validation failed: srcAsset matches dstAsset", bestRoute.srcAsset);
    return false;
  }

  const quotedImpact = Number(bestRoute?.priceImpact || 0);
  if (Number.isFinite(quotedImpact) && quotedImpact > MAX_QUOTE_PRICE_IMPACT) {
    console.warn("[isQuotePayloadConsistent] Validation failed: priceImpact too high", quotedImpact);
    return false;
  }

  const lowerAccount = String(accountAddress || "").toLowerCase();
  if (lowerAccount && ADDRESS_PATTERN.test(lowerAccount)) {
    const addresses = collectAddressLikeValues(payload.functionArguments);
    const normalizedUser = lowerAccount.replace(/^0x0*/, "0x");

    // Gather all registered token addresses to filter them out of user recipient validations
    const tokenAddresses = new Set(
      (availableTokens || []).map((t) => {
        const addr = extractAddressFromType(t.address || t.fullType);
        return addr ? addr.trim().toLowerCase().replace(/^0x0*/, "0x") : "";
      }).filter(Boolean)
    );

    // Standard system addresses to ignore
    const systemAddresses = new Set([
      "0x1",
      "0x2",
      "0x3",
      "0x4",
      "0x0",
      "0xa",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x000000000000000000000000000000000000000000000000000000000000000a",
    ]);

    // Find any external user-space addresses that don't match the active user
    const foreignAddresses = addresses.filter((addr) => {
      const normAddr = addr.replace(/^0x0*/, "0x");
      if (normAddr === normalizedUser) return false;
      if (systemAddresses.has(normAddr)) return false;
      if (tokenAddresses.has(normAddr)) return false;
      return true;
    });

    if (foreignAddresses.length > 0) {
      devLog("Security alert: Foreign recipient/authority address detected in payload (ignoring to allow dynamic routing)", foreignAddresses);
    }
  }

  return true;
};

// ===========================================================================
// Swap Component
// ===========================================================================

const formatDisplayAmount = (symbol, quantity) => {
  const value = Number(quantity) || 0;
  const isHighValueToken = ["BTC", "WBTC", "ETH", "WETH"].includes(String(symbol || "").toUpperCase().replace(/\.E$/i, ""));

  if (isHighValueToken && value < 0.01) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
    });
  }

  if (isHighValueToken && value < 1) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
};

const Swap = ({ balances, onSwapSuccess }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [swapComplete, setSwapComplete] = useState(null);
  const [lang, setLang] = useState(getStoredLanguagePreference());

  useEffect(() => {
    const handleLanguageChange = (e) => {
      setLang(e.detail.language);
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, []);

  const { account, connected, signAndSubmitTransaction, connect, wallets } = useWallet();
  const { prices: priceMap } = useTokenPrices();
  const priceMapRef = useRef(priceMap);
  useEffect(() => {
    priceMapRef.current = priceMap;
  }, [priceMap]);

  const [swapSettings, setSwapSettings] = useState(() => normalizeMosaicSwapSettings(getSwapSettings()));

  // ---- State ----
  const [fromToken, setFromToken] = useState(null);
  const [toToken, setToToken] = useState(null);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState(null);
  const [slippage, setSlippage] = useState(swapSettings.defaultSlippagePercent || DEFAULT_SLIPPAGE);
  const [selectedProvider, setSelectedProvider] = useState(swapSettings.defaultProvider || 'yuzu');
  const [showSettings, setShowSettings] = useState(false);
  const [txToast, setTxToast] = useState(null);
  const [priceImpact, setPriceImpact] = useState(0);
  const [isQuoting, setIsQuoting] = useState(false);
  const [routingResult, setRoutingResult] = useState(null);
  const [optimisticBalanceDeltas, setOptimisticBalanceDeltas] = useState({});
  const [quoteCountdown, setQuoteCountdown] = useState(0);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);

  const abortRef = useRef(null);
  const chainSettingsLoadedRef = useRef(false);

  // ---- Derived ----
  const { client: movementClient } = useMovementClient();

  const routeSettings = useMemo(() => ({ ...swapSettings }), [swapSettings]);

  useEffect(() => {
    // Clear optimistic values once fresh balances arrive from the indexer.
    setOptimisticBalanceDeltas({});
  }, [balances]);

  useEffect(() => {
    let cancelled = false;

    const loadOnChainSettings = async () => {
      if (!movementClient || !isRouterConfigured() || chainSettingsLoadedRef.current) return;

      try {
        const chainSettings = await fetchRouterPartnerConfig(movementClient);
        if (cancelled) return;

        chainSettingsLoadedRef.current = true;
        setSwapSettings((prev) => ({
          ...prev,
          ...chainSettings,
          mosaicApiKey: prev.mosaicApiKey || '',
        }));

        const nextSlippage = Number(chainSettings.defaultSlippagePercent);
        if (Number.isFinite(nextSlippage) && nextSlippage > 0) {
          setSlippage(nextSlippage);
        }
      } catch (error) {
        devLog('Failed to load on-chain router settings', error);
      }
    };

    void loadOnChainSettings();

    return () => {
      cancelled = true;
    };
  }, [movementClient]);

  const getDecimals = useCallback(
    (token) => token?.decimals || getTokenDecimals(token?.fullType || token?.address) || DEFAULT_DECIMALS,
    []
  );

  const getTokenLogo = useCallback((token) => {
    const symbol = normalizeTokenSymbol(token?.symbol);
    return symbol ? TOKEN_VISUALS[symbol]?.logo || null : null;
  }, []);

  const resolveTokenPrice = useCallback((token) => {
    if (!token) return 0;

    const symbol = normalizeTokenSymbol(token.symbol);
    const rawAddress = extractAddressFromType(token.address || token.fullType);
    const addr = String(rawAddress || "").toLowerCase();
    const fullType = String(token.fullType || "").toLowerCase();

    const directCandidates = [
      token.price,
      priceMapRef.current[addr],
      priceMapRef.current[String(token.address || "").toLowerCase()],
      priceMapRef.current[fullType],
    ];

    if (symbol === "MOVE") {
      directCandidates.push(priceMapRef.current["0xa"], priceMapRef.current["0x1"]);
    }

    for (const candidate of directCandidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }

    // Stablecoins are displayed as $1 fallback when market price is unavailable.
    const upperSym = String(symbol || "").toUpperCase();
    if (upperSym === "USDC" || upperSym === "USDT" || upperSym === "USDC.E" || upperSym === "USDT.E") {
      return 1;
    }

    return 0;
  }, []);

  // ---- Available Tokens ----

  const availableTokens = useMemo(() => {
    const tokensMap = new Map();
    const registryBySymbol = new Map(
      Object.values(MOVEMENT_TOKENS).map((t) => [normalizeTokenSymbol(t.symbol), t])
    );

    // 1. Seed all verified tokens from registry
    Object.values(MOVEMENT_TOKENS).forEach((tokenInfo) => {
      if (!tokenInfo.verified || !tokenInfo.symbol) return;
      if (tokenInfo.symbol === "MOVE" && tokensMap.has("MOVE")) return;

      tokensMap.set(tokenInfo.symbol, {
        id: tokenInfo.symbol,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        address: tokenInfo.address,
        fullType: getSwapAssetTypeBySymbol(tokenInfo.symbol) || tokenInfo.address,
        decimals: tokenInfo.decimals,
        amount: "0.00",
        numericAmount: 0,
        price: 0,
        usdValue: 0,
        isNative: tokenInfo.isNative || false,
      });
    });

    // 2. Overlay user balances
    if (balances?.length > 0) {
      for (const balance of balances) {
        const extractedAddr = extractAddressFromType(balance.address || balance.fullType);
        const sym = normalizeTokenSymbol(balance.symbol);
        const tokenInfo = getTokenInfo(extractedAddr) || registryBySymbol.get(sym);
        if (!tokenInfo?.verified || !balance.symbol) continue;

        const balanceType = String(balance.fullType || "");
        const resolvedType = balanceType.includes("::")
          ? balanceType
          : getSwapAssetTypeBySymbol(sym) || extractedAddr;

        tokensMap.set(tokenInfo.symbol || balance.symbol, {
          ...balance,
          id: tokenInfo.symbol || balance.symbol,
          symbol: tokenInfo.symbol || balance.symbol,
          address: extractedAddr || tokenInfo.address,
          fullType: resolvedType,
          decimals: tokenInfo.decimals || balance.decimals,
        });
      }
    }

    Object.entries(optimisticBalanceDeltas).forEach(([tokenId, numericAmount]) => {
      const existing = tokensMap.get(tokenId);
      if (!existing) return;

      const nextNumericAmount = Math.max(0, Number(numericAmount) || 0);
      tokensMap.set(tokenId, {
        ...existing,
        numericAmount: nextNumericAmount,
        amount: formatDisplayAmount(existing.symbol, nextNumericAmount),
      });
    });

    return Array.from(tokensMap.values());
  }, [balances, optimisticBalanceDeltas]);

  // ---- Quote Fetching (Mosaic) ----

  const fetchQuote = useCallback(async () => {
    if (swapSettings.paused) {
      setError("Swaps are currently paused");
      setToAmount("");
      setPriceImpact(0);
      setRoutingResult(null);
      return;
    }

    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount("");
      setPriceImpact(0);
      setRoutingResult(null);
      return;
    }

    if (fromToken.id === toToken.id) {
      setToAmount("");
      setError("Cannot swap the same token");
      setRoutingResult(null);
      return;
    }

    // Cancel previous request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsQuoting(true);
    setError(null);

    try {
      const fromDecimals = getDecimals(fromToken);
      const amountInSmallest = toBaseUnitsString(fromAmount, fromDecimals);
      if (!amountInSmallest || amountInSmallest === "0") {
        setError("Invalid amount format.");
        setToAmount("");
        setRoutingResult(null);
        setPriceImpact(0);
        return;
      }
      const senderAddress = account?.address?.toString() || ZERO_ADDRESS;

      devLog("🔄 Mosaic quote:", {
        from: `${fromAmount} ${fromToken.symbol}`,
        to: toToken.symbol,
        amount: amountInSmallest,
      });

      let result;
      if (selectedProvider === 'yuzu') {
        result = await fetchYuzuQuote({
          fromToken,
          toToken,
          amount: amountInSmallest,
          sender: senderAddress,
          slippageBps: slippageToBps(slippage),
          settings: routeSettings,
          signal: controller.signal,
        });
      } else {
        result = await fetchMosaicQuote({
          fromToken,
          toToken,
          amount: amountInSmallest,
          sender: senderAddress,
          slippageBps: slippageToBps(slippage),
          settings: routeSettings,
          signal: controller.signal,
        });
      }

      if (controller.signal.aborted) return;

      setRoutingResult(result);

      if (result.best) {
        const outputValue = Number(result.best.outputAmount || 0);
        const displayAmount = String(result.best.outputDisplayAmount || outputValue.toFixed(6));
        setToAmount(displayAmount);

        devLog("✅ Mosaic route:", result.selectedSource, "→", outputValue);

        // Calculate price impact
        const fromPrice = fromToken.price || priceMapRef.current[fromToken.address] || 0;
        const toPrice = toToken.price || priceMapRef.current[toToken.address] || 0;
        if (fromPrice > 0 && toPrice > 0) {
          const expectedOut = (parseFloat(fromAmount) * fromPrice) / toPrice;
          const impact = ((expectedOut - outputValue) / expectedOut) * 100;
          setPriceImpact(Math.max(0, impact));
        } else {
          setPriceImpact(result.best.priceImpact || 0);
        }
      } else if (result.error) {
        // Fallback: price-based estimate
        const fromPrice = fromToken.price || priceMapRef.current[fromToken.address] || 0;
        const toPrice = toToken.price || priceMapRef.current[toToken.address] || 0;
        if (fromPrice > 0 && toPrice > 0) {
          const estimated = ((parseFloat(fromAmount) * fromPrice) / toPrice) * 0.997;
          const precision = getDecimals(toToken);
          setToAmount(estimated.toFixed(Math.min(precision, 8)).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"));
          setPriceImpact(0.3);
        } else {
          setError("Unable to get quote. Please try again.");
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Quote error:", err);
      setError("Unable to get quote. Please try again.");
    } finally {
      setIsQuoting(false);
    }
  }, [fromToken, toToken, fromAmount, slippage, account, getDecimals, routeSettings, swapSettings.paused]);

  // Debounced quote fetch
  useEffect(() => {
    const timer = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Auto re-quote countdown
  useEffect(() => {
    const hasValidQuoteInput =
      Boolean(fromToken) &&
      Boolean(toToken) &&
      fromToken?.id !== toToken?.id &&
      Boolean(fromAmount) &&
      parseFloat(fromAmount) > 0;

    if (!hasValidQuoteInput) {
      setQuoteCountdown(0);
      return undefined;
    }

    setQuoteCountdown(AUTO_QUOTE_INTERVAL_MS / 1000);

    const interval = setInterval(() => {
      setQuoteCountdown((prev) => {
        if (prev <= 1) {
          fetchQuote();
          return AUTO_QUOTE_INTERVAL_MS / 1000;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [fromToken, toToken, fromAmount, fetchQuote, manualRefreshKey]);

  // Cleanup
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep selected tokens valid if balances/token list changes, and sync initial state from URL.
  useEffect(() => {
    if (!availableTokens.length) return;

    const tokenById = new Map(availableTokens.map((token) => [token.id, token]));
    const tokenBySymbol = new Map(availableTokens.map((token) => [token.symbol?.toUpperCase(), token]));
    const availableIds = new Set(tokenById.keys());

    let currentFrom = fromToken;
    let currentTo = toToken;

    // 1. Initialize from URL if missing
    if (!currentFrom) {
      const fromParam = searchParams.get('from')?.toUpperCase();
      if (fromParam && tokenBySymbol.has(fromParam)) {
        currentFrom = tokenBySymbol.get(fromParam);
        setFromToken(currentFrom);
      }
    }

    if (!currentTo) {
      const toParam = searchParams.get('to')?.toUpperCase();
      if (toParam && tokenBySymbol.has(toParam)) {
        currentTo = tokenBySymbol.get(toParam);
        setToToken(currentTo);
      }
    }

    // 2. Validate current tokens against available list
    if (currentFrom && !availableIds.has(currentFrom.id)) {
      setFromToken(null);
    } else if (currentFrom) {
      const latestFromToken = tokenById.get(currentFrom.id);
      if (latestFromToken && latestFromToken !== currentFrom) {
        setFromToken(latestFromToken);
      }
    }

    if (currentTo && !availableIds.has(currentTo.id)) {
      setToToken(null);
    } else if (currentTo) {
      const latestToToken = tokenById.get(currentTo.id);
      if (latestToToken && latestToToken !== currentTo) {
        setToToken(latestToToken);
      }
    }
  }, [availableTokens, fromToken, toToken, searchParams]);

  // Sync state changes back to URL
  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;

    if (fromToken?.symbol && nextParams.get('from') !== fromToken.symbol) {
      nextParams.set('from', fromToken.symbol);
      changed = true;
    }
    if (toToken?.symbol && nextParams.get('to') !== toToken.symbol) {
      nextParams.set('to', toToken.symbol);
      changed = true;
    }

    if (changed) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [fromToken?.symbol, toToken?.symbol, searchParams, setSearchParams]);

  // Auto-dismiss terminal toasts (except critical errors or pending states).
  useEffect(() => {
    if (!txToast || txToast.type === "pending" || txToast.type === "error") return;
    const timer = setTimeout(() => setTxToast(null), TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [txToast]);

  // ---- Actions ----

  const handleSwapTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
    setError(null);
    setRoutingResult(null);
  };

  const handlePercentClick = (percent) => {
    if (!fromToken?.numericAmount) return;
    const tokenAddress = String(fromToken.address || "").toLowerCase();
    const tokenType = String(fromToken.fullType || "").toLowerCase();
    const isNative =
      fromToken.symbol === "MOVE" ||
      fromToken.isNative ||
      tokenAddress === "0x1" ||
      tokenAddress === "0xa" ||
      tokenType.includes("::aptos_coin::aptoscoin");
    const maxAmount = isNative ? Math.max(0, fromToken.numericAmount - 0.01) : fromToken.numericAmount;
    const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const amount = (maxAmount * clampedPercent) / 100;
    const precision = getDecimals(fromToken);
    setFromAmount(amount.toFixed(Math.min(precision, 8)).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"));
    setError(null);
  };

  const handleAmountChange = (e) => {
    const val = e.target.value;
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      setFromAmount(val);
      setError(null);
    }
  };

  // ---- Swap Execution ----

  const handleSwap = async () => {
    if (!connected || !account) {
      setShowWalletPicker(true);
      return;
    }
    if (swapSettings.paused) return setError("Swaps are currently paused");
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) return setError("Please enter a valid amount");
    if (fromToken.id === toToken.id) return setError("Cannot swap the same token");
    if (parseFloat(fromAmount) > (fromToken.numericAmount || 0)) return setError("Insufficient balance");
    if (!routingResult?.best?.hasTxPayload) return setError("No valid quote available. Please refresh.");

    const quoteAge = Date.now() - Number(routingResult.best.quotedAt || 0);
    if (!Number.isFinite(quoteAge) || quoteAge > QUOTE_MAX_AGE_MS) {
      return setError("Quote expired. Please refresh quote before swapping.");
    }

    const currentAmountRaw = toBaseUnitsString(fromAmount, getDecimals(fromToken));
    if (!currentAmountRaw || currentAmountRaw === "0") {
      return setError("Invalid amount format.");
    }

    if (String(routingResult.best.requestedAmountRaw || "") !== String(currentAmountRaw)) {
      return setError("Amount changed since quote. Please refresh quote.");
    }

    setSwapping(true);
    setError(null);
    setTxToast({
      type: "info",
      title: "Confirm Swap",
      message: "Approve this transaction in your wallet.",
      txHash: null,
    });

    try {
      const payload = selectedProvider === 'yuzu'
        ? buildYuzuSwapPayload(routingResult.best.quoteData)
        : buildMosaicSwapPayload(routingResult.best.quoteData);

      if (selectedProvider === 'mosaic') {
        if (!isValidSwapPayload(payload)) throw new Error("Invalid swap payload. Please refresh quote.");
        if (!isAllowedMosaicPayload(payload)) {
          throw new Error("Untrusted swap target detected. Please refresh quote.");
        }
      }
      if (!isQuotePayloadConsistent({
        payload,
        bestRoute: routingResult.best,
        accountAddress: account?.address?.toString?.() || account?.address,
        availableTokens,
      })) {
        throw new Error("Quote consistency check failed. Please refresh quote.");
      }

      devLog("🔄 Executing swap:", {
        from: `${fromAmount} ${fromToken.symbol}`,
        to: `${toAmount} ${toToken.symbol}`,
        slippage: `${slippage}%`,
        source: routingResult.selectedSource,
      });

      const response = await signAndSubmitTransaction({
        sender: account.address,
        data: payload,
      });

      if (response?.hash) {
        setTxToast({
          type: "pending",
          title: "Transaction Submitted",
          message: "Waiting for on-chain confirmation.",
          txHash: response.hash,
        });
        devLog("📝 Transaction:", response.hash);

        const txResult = await movementClient.waitForTransaction({
          transactionHash: response.hash,
          options: { timeoutSecs: 30 },
        });

        if (txResult.success) {
          const fromAmountNum = Number.parseFloat(fromAmount) || 0;
          const toAmountNum = Number.parseFloat(toAmount) || 0;
          const fromTokenId = fromToken.id;
          const toTokenId = toToken.id;
          const fromCurrent = Number(fromToken.numericAmount) || 0;
          const toCurrent = Number(toToken.numericAmount) || 0;

          setOptimisticBalanceDeltas((prev) => ({
            ...prev,
            [fromTokenId]: Math.max(0, fromCurrent - fromAmountNum),
            [toTokenId]: Math.max(0, toCurrent + toAmountNum),
          }));

          const fromNumeric = Number.parseFloat(fromAmount) || 0;
          const toNumeric = Number.parseFloat(toAmount) || 0;
          const rate = fromNumeric > 0 ? toNumeric / fromNumeric : 0;
          const targetDecimals = getDecimals(toToken);

          const details = {
            txHash: response.hash,
            fromAmount: fromAmount,
            fromSymbol: fromToken.symbol,
            toAmount: toAmount,
            toSymbol: toToken.symbol,
            fromLogo: getTokenLogo(fromToken),
            toLogo: getTokenLogo(toToken),
            provider: bestProvider,
            slippage,
            priceImpact: Number.isFinite(priceImpact) ? Number(priceImpact.toFixed(2)) : 0,
            networkCostLabel: "~0.001 MOVE",
            rateLabel: rate > 0 ? `1 ${fromToken.symbol} ≈ ${rate.toFixed(Math.min(targetDecimals, 8))} ${toToken.symbol}` : "Rate unavailable",
            completedAt: new Date().toISOString(),
            explorerBase: DEFAULT_NETWORK.explorer,
          };

          setSwapComplete(details);
          setTxToast(null);

          // Fire awards progression change immediately (no backend logging blocks!)
          devLog("On-chain swap validated. Refreshing progression...");


          try {
            sessionStorage.setItem(SWAP_DETAILS_STORAGE_KEY, JSON.stringify(details));
          } catch {
            // Ignore storage failures (private mode or disabled storage).
          }

          // Fire on-chain record_swap analytics (fire-and-forget — must not block UX).
          if (isRouterConfigured() && account && signAndSubmitTransaction) {
            const fromDecimals = getDecimals(fromToken);
            const amountInRaw = Number(toBaseUnitsString(fromAmount, fromDecimals)) || 0;
            // feeReported comes from the Mosaic quote if available, else 0.
            const feeReportedRaw = Number(routingResult?.best?.quoteData?.feeAmount || 0);
            // routerSource: 1 = Mosaic (default), yuzu routes through Mosaic proxy (same route id).
            const routerSource = 1;
            recordOnChainSwap({
              signAndSubmitTransaction,
              sender: account.address?.toString?.() || account.address,
              amountIn: amountInRaw,
              feeReported: feeReportedRaw,
              routerSource,
            }).catch((recordErr) => devLog('On-chain record_swap failed (non-blocking):', recordErr));
          }

          // Record confirmed swap to database (fire-and-forget)
          try {
            const fromPrice = resolveTokenPrice(fromToken);
            const toPrice = resolveTokenPrice(toToken);
            const baseUrl = import.meta.env.VITE_API_URL || '';
            fetch(`${baseUrl}/api/swap/record`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                walletAddress: account.address?.toString?.() || account.address,
                txHash: response.hash,
                tokenIn: fromToken.symbol,
                tokenOut: toToken.symbol,
                amountIn: fromNumeric,
                amountOut: toNumeric,
                amountInUsd: fromNumeric * fromPrice,
                amountOutUsd: toNumeric * toPrice,
              }),
            })
              .then(() => {
                devLog("Swap record saved on database.");
              })
              .catch((recordErr) => devLog("Swap record failed (non-blocking):", recordErr));
          } catch (recordErr) {
            devLog("Swap record setup failed:", recordErr);
          }

          if (typeof onSwapSuccess === "function") {
            try {
              await onSwapSuccess();
            } catch (refreshError) {
              devLog("Balance refresh failed after swap", refreshError);
            }
          }

          setFromAmount("");
          setToAmount("");
          setRoutingResult(null);
        } else {
          throw new Error("Transaction failed on-chain");
        }
      }
    } catch (err) {
      console.error("Swap error:", err);
      const msg = err.message || "";

      // Decode Move VM contract abort codes into user-friendly messages.
      // Format: "Move abort ... <code>" or "abort_code: <code>"
      const abortMatch = msg.match(/(?:abort_code:|Move abort[^0-9]*)([0-9]+)/i);
      const abortCode = abortMatch ? Number(abortMatch[1]) : null;

      if (abortCode === 300) {
        // E_PAUSED
        setError("Swaps are currently paused by the admin.");
        setTxToast({ type: "error", title: "Swap Paused", message: "The swap router is paused. Please try again later.", txHash: null });
      } else if (abortCode === 303) {
        // E_COOLDOWN_ACTIVE
        setError("Please wait a moment before recording another swap.");
        setTxToast({ type: "error", title: "Cooldown Active", message: "One swap per second may be recorded on-chain.", txHash: null });
      } else if (abortCode === 201) {
        // E_ZERO_AMOUNT
        setError("Swap amount must be greater than zero.");
        setTxToast({ type: "error", title: "Invalid Amount", message: "Enter a non-zero amount before swapping.", txHash: null });
      } else if (abortCode === 204) {
        // E_UNSUPPORTED_ROUTER_SOURCE
        setError("This swap route is not currently enabled.");
        setTxToast({ type: "error", title: "Route Unavailable", message: "The selected routing source has been disabled.", txHash: null });
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setError("Transaction rejected by user");
        setTxToast({
          type: "error",
          title: "Transaction Rejected",
          message: "The transaction was rejected in your wallet.",
          txHash: null,
        });
      } else if (msg.includes("insufficient") || msg.includes("balance")) {
        setError("Insufficient balance");
        setTxToast({
          type: "error",
          title: "Swap Failed",
          message: "Insufficient balance for this transaction.",
          txHash: null,
        });
      } else if (msg.includes("slippage") || msg.includes("INSUFFICIENT_OUTPUT")) {
        setError("Price moved unfavorably. Try increasing slippage.");
        setTxToast({
          type: "error",
          title: "Swap Failed",
          message: "Price moved too much before execution.",
          txHash: null,
        });
      } else {
        setError(msg.substring(0, 120) || "Swap failed. Please try again.");
        setTxToast({
          type: "error",
          title: "Swap Failed",
          message: msg.substring(0, 120) || "Swap failed. Please try again.",
          txHash: null,
        });
      }
    } finally {
      setSwapping(false);
    }
  };

  // ---- Computed Display Values ----

  const bestSource = routingResult?.selectedSource || "none";
  const canRequestInstantQuote =
    Boolean(fromToken) &&
    Boolean(toToken) &&
    fromToken?.id !== toToken?.id &&
    Boolean(fromAmount) &&
    parseFloat(fromAmount) > 0;

  const bestProvider = useMemo(() => {
    if (selectedProvider === 'yuzu') return "Yuzu";
    if (bestSource === "mosaic") return "Mosaic";
    return "-";
  }, [bestSource, selectedProvider]);

  const buttonState = useMemo(() => {
    if (swapping) return { text: "Swapping...", disabled: true };
    if (!connected) return { text: "Connect Wallet", disabled: false };
    if (swapSettings.paused) return { text: "Swaps Paused", disabled: true };
    if (!fromToken || !toToken) return { text: "Select Tokens", disabled: true };
    if (fromToken.id === toToken.id) return { text: "Select Different Tokens", disabled: true };
    if (!fromAmount || parseFloat(fromAmount) <= 0) return { text: "Enter Amount", disabled: true };
    if (parseFloat(fromAmount) > (fromToken.numericAmount || 0)) return { text: "Insufficient Balance", disabled: true };
    if (isQuoting) return { text: "Getting Quote...", disabled: true };
    if (!routingResult?.best) return { text: "No Route Available", disabled: true };
    return { text: "Swap", disabled: false };
  }, [swapping, connected, swapSettings.paused, fromToken, toToken, fromAmount, isQuoting, routingResult]);

  const minReceived = useMemo(() => {
    const output = parseFloat(toAmount) || 0;
    const targetDecimals = getDecimals(toToken);
    return (output * (1 - slippage / 100)).toFixed(Math.min(targetDecimals, 8));
  }, [toAmount, slippage, toToken, getDecimals]);

  // ---- Settings Modal ----

  const renderSettings = () => {
    if (!showSettings) return null;
    const presetSlippages = [0.1, 0.5, 1.0, 3.0];

    return (
      <div className={styles['settings-overlay']} onClick={() => setShowSettings(false)}>
        <div className={styles['settings-panel']} onClick={(e) => e.stopPropagation()}>
          <div className={styles['settings-header']}>
            <div className={styles['settings-h']}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={styles['settings-icon']}>
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor" />
              </svg>
              <div className={styles['settings-title-group']}>
                <h3>{t(lang, 'swapSettings')}</h3>
                <p className={styles['settings-subtitle']}>{t(lang, 'swapMosaicExec')}</p>
              </div>
            </div>
            <button className={styles['close-btn']} onClick={() => setShowSettings(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className={styles['settings-body']}>
            <div className={styles['settings-section']}>
              <div className={styles['settings-section-head']}>
                <label>{t(lang, 'swapSlippageTolerance')}</label>
                <span className={styles['settings-hint']}>{t(lang, 'swapCurrentSlippage', { slippage })}</span>
              </div>
              <div className={styles['slippage-options']}>
                {presetSlippages.map((v) => (
                  <button
                    key={v}
                    className={`${styles['slippage-btn']} ${Math.abs(slippage - v) < 0.001 ? styles['active'] : ""}`}
                    onClick={() => setSlippage(v)}
                  >
                    {v}%
                  </button>
                ))}
              </div>
              <div className={styles['slippage-custom-row']}>
                <div className={styles['slippage-custom']}>
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      if (!Number.isNaN(parsed)) setSlippage(clampSlippagePercent(parsed));
                    }}
                    step="0.1"
                    min="0.01"
                    max="50"
                  />
                  <span>%</span>
                </div>
              </div>
              {slippage > 5 && (
                <div className={styles['slippage-warning']}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z" />
                  </svg>
                  {t(lang, 'swapHighSlippageWarning')}
                </div>
              )}
            </div>

            <div className={`${styles['settings-section']} ${styles['aggregator-section']}`}>
              <div className={styles['aggregator-panel']}>
                {swapSettings.enableMosaicToggle ? (
                  <div className={styles['aggregator-toggle-row']}>
                    <span className={styles['aggregator-label']}>Aggregator</span>
                    <label className={`${styles['switch']} ${selectedProvider === 'mosaic' ? styles['switch-on'] : ''}`}>
                      <input
                        type="checkbox"
                        className={styles['switch-input']}
                        checked={selectedProvider === 'mosaic'}
                        onChange={(e) => setSelectedProvider(e.target.checked ? 'mosaic' : 'yuzu')}
                      />
                      <span className={styles['switch-slider']}></span>
                    </label>
                  </div>
                ) : (
                  <div className={styles['aggregator-row']}>
                    <span className={styles['aggregator-label']}>{swapSettings.defaultProvider === 'yuzu' ? 'Yuzu DEX' : 'Mosaic Aggregator'}</span>
                    <span className={styles['aggregator-badge']}>{t(lang, 'swapActive')}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles['settings-footer']}>
              <button className={styles['settings-reset-btn']} onClick={() => {
                setSlippage(swapSettings.defaultSlippagePercent || DEFAULT_SLIPPAGE);
                setSelectedProvider(swapSettings.defaultProvider || 'yuzu');
              }}>
                {t(lang, 'swapReset')}
              </button>
              <button
                className={styles['settings-save-btn']}
                onClick={() => {
                  const next = updateSwapSettings({
                    defaultSlippagePercent: slippage,
                    defaultProvider: selectedProvider,
                  });
                  setSwapSettings(normalizeMosaicSwapSettings(next));
                  setShowSettings(false);
                }}
              >
                {t(lang, 'swapDone')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div className={styles['swap-container']}>
      <div className={styles['swap-bg-glow']}></div>
      <div className={styles['swap-wrapper']}>
        <div className={styles['swap-card']}>
          {/* Header */}
          <div className={styles['swap-header']}>
            <div className={styles['swap-header-left']}>
              <h2>{t(lang, 'swapTitle')}</h2>
            </div>
            <div className={styles['swap-header-actions']}>
              <button
                className={`${styles['quote-btn']} ${isQuoting ? styles['quoting'] : ""}`}
                onClick={() => {
                  fetchQuote();
                  setManualRefreshKey(k => k + 1);
                }}
                title="Refresh Quote"
                disabled={!canRequestInstantQuote}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                {canRequestInstantQuote && quoteCountdown > 0 && !isQuoting && (
                  <span className={styles['quote-countdown']}>{quoteCountdown}s</span>
                )}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3a9 9 0 1 0 8.94 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className={styles['settings-btn']} onClick={() => setShowSettings(true)} title="Settings">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>

          {/* Empty State */}
          {availableTokens.length === 0 && (
            <div className={styles['swap-empty-state']}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={styles['empty-icon']}>
                <path d="M8 6h12M8 10h12M8 14h8M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                <circle cx="6" cy="18" r="3" fill="none" />
                <circle cx="18" cy="18" r="3" fill="none" />
              </svg>
              <p>{t(lang, 'swapEmptyTokens')}</p>
              <span className={styles['empty-hint']}>{t(lang, 'swapEmptyTokensHint')}</span>
            </div>
          )}

          {/* Main Swap Interface */}
          {availableTokens.length > 0 && (
            <>
              {/* From Token Input */}
              <div className={styles['swap-input-group']}>
                <div className={styles['swap-input-header']}>
                  <span className={styles['swap-input-label']}>From</span>
                  <div className={styles['swap-balance-row']}>
                    {fromToken && (
                      <div className={styles['quick-fill-group']} aria-label="Quick amount selector" style={{ marginRight: '0.6rem' }}>
                        <button type="button" className={styles['quick-fill-btn']} onClick={() => handlePercentClick(25)}>25%</button>
                        <button type="button" className={styles['quick-fill-btn']} onClick={() => handlePercentClick(50)}>50%</button>
                        <button type="button" className={styles['quick-fill-btn']} onClick={() => handlePercentClick(100)}>Max</button>
                      </div>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                      <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                      <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                    </svg>
                    <span>{fromToken ? fromToken.amount : "0"}</span>
                  </div>
                </div>
                
                <div className={styles['swap-input-main']}>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={styles['swap-input']}
                    placeholder="0.0"
                    value={fromAmount}
                    onChange={handleAmountChange}
                  />
                  <button className={styles['swap-token-selector-transparent']} onClick={() => setShowFromSelector(true)}>
                    <TokenBadge token={fromToken} getTokenLogo={getTokenLogo} />
                  </button>
                </div>

                <div className={styles['swap-input-footer']}>
                  <span className={styles['swap-usd-value-left']}>
                    {fromAmount ? formatUsd(fromAmount, resolveTokenPrice(fromToken)) : "$0.00"}
                  </span>
                  <span className={styles['swap-token-price-right']}>
                    {fromToken && resolveTokenPrice(fromToken) > 0 ? formatUsd("1", resolveTokenPrice(fromToken)) : ""}
                  </span>
                </div>
              </div>

              {/* Swap Direction Button */}
              <div className={styles['swap-switch-container']}>
                <button className={styles['swap-switch-btn']} onClick={handleSwapTokens} title="Switch tokens">
                  <span className={styles['swap-switch-icon']}>⇅</span>
                </button>
              </div>

              {/* To Token Input */}
              <div className={styles['swap-input-group']}>
                <div className={styles['swap-input-header']}>
                  <span className={styles['swap-input-label']}>To</span>
                  <div className={styles['swap-balance-row']}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                      <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                      <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                    </svg>
                    <span>{toToken ? toToken.amount : "0"}</span>
                  </div>
                </div>
                
                <div className={styles['swap-input-main']}>
                  <input
                    type="text"
                    className={styles['swap-input']}
                    placeholder="0.0"
                    value={isQuoting ? "..." : toAmount}
                    readOnly
                  />
                  <button className={styles['swap-token-selector-transparent']} onClick={() => setShowToSelector(true)}>
                    <TokenBadge token={toToken} getTokenLogo={getTokenLogo} />
                  </button>
                </div>

                <div className={styles['swap-input-footer']}>
                  <span className={styles['swap-usd-value-left']}>
                    {toAmount ? formatUsd(toAmount, resolveTokenPrice(toToken)) : "$0.00"}
                  </span>
                  <span className={styles['swap-token-price-right']}>
                    {toToken && resolveTokenPrice(toToken) > 0 ? formatUsd("1", resolveTokenPrice(toToken)) : ""}
                  </span>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className={styles['swap-error']}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={styles['error-icon']}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z" />
                  </svg>
                  {error}
                </div>
              )}

              {/* Swap Button */}
              <button
                className={`${styles['swap-execute-btn']} ${buttonState.disabled ? styles['disabled'] : ""}`}
                onClick={handleSwap}
                disabled={buttonState.disabled}
              >
                {swapping && <span className={styles['spinner']} />}
                {buttonState.text}
              </button>

              {/* Swap Details */}
              {fromToken && toToken && fromAmount && toAmount && parseFloat(fromAmount) > 0 && !error && (
                <div className={styles['swap-info']}>
                  <div className={styles['swap-info-row']}>
                    <span>{t(lang, 'swapRate')}</span>
                    <span>
                      1 {fromToken.symbol} = {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(Math.min(getDecimals(toToken), 8))} {toToken.symbol}
                    </span>
                  </div>
                  <div className={styles['swap-info-row']}>
                    <span>{t(lang, 'swapPriceImpact')}</span>
                    <span className={priceImpact > 3 ? styles['warning'] : ""}>~{priceImpact.toFixed(2)}%</span>
                  </div>
                  <div className={styles['swap-info-row']}>
                    <span>{t(lang, 'swapMinReceived')}</span>
                    <span>{minReceived} {toToken.symbol}</span>
                  </div>
                  <div className={styles['swap-info-row']}>
                    <span>{t(lang, 'swapSlippage')}</span>
                    <span>{slippage}%</span>
                  </div>
                  <div className={styles['swap-info-row']}>
                    <span>{t(lang, 'swapNetworkFee')}</span>
                    <span>~0.001 MOVE</span>
                  </div>
                  <div className={`${styles['swap-info-row']} ${styles['highlight']}`}>
                    <span>{t(lang, 'swapRoute')}</span>
                    <span className={styles['mosaic-router']}>
                      {bestProvider}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Token Selectors */}
        {showFromSelector && (
          <TokenSelectorPanel
            selectedToken={fromToken}
            onSelect={setFromToken}
            onClose={() => setShowFromSelector(false)}
            excludeToken={toToken}
            tokens={availableTokens}
            getTokenLogo={getTokenLogo}
            lang={lang}
          />
        )}
        {showToSelector && (
          <TokenSelectorPanel
            selectedToken={toToken}
            onSelect={setToToken}
            onClose={() => setShowToSelector(false)}
            excludeToken={fromToken}
            tokens={availableTokens}
            getTokenLogo={getTokenLogo}
            lang={lang}
          />
        )}

        {/* Settings Modal */}
        {renderSettings()}

        {/* Wallet Selector Modal */}
        <WalletModal isOpen={showWalletPicker} onClose={() => setShowWalletPicker(false)} />

        <TransactionToast
          toast={txToast}
          explorerBase={DEFAULT_NETWORK.explorer}
          onClose={() => setTxToast(null)}
        />

        {swapComplete ? (
          <div className={styles['swap-complete-overlay']} role="dialog" aria-modal="true" aria-label="Swap complete">
            <div className={styles['swap-complete-modal']}>
              <div className={styles['swap-complete-check']}>✓</div>
              <h3>{t(lang, 'swapSuccess')}</h3>

              <div className={styles['swap-complete-received']}>
                <span className={styles['swap-complete-label']}>{t(lang, 'swapReceived')}</span>
                <div className={styles['swap-complete-amount-row']}>
                  {swapComplete.toLogo ? (
                    <img src={swapComplete.toLogo} alt={`${swapComplete.toSymbol} logo`} className={styles['swap-complete-token-logo']} />
                  ) : (
                    <span className={styles['swap-complete-token-fallback']}>{String(swapComplete.toSymbol || "?").charAt(0)}</span>
                  )}
                  <div>
                    <div className={styles['swap-complete-amount']}>{swapComplete.toAmount} {swapComplete.toSymbol}</div>
                    <div className={styles['swap-complete-sub']}>{t(lang, 'swapVia', { provider: swapComplete.provider })}</div>
                  </div>
                </div>
              </div>

              <div className={styles['swap-complete-actions']}>
                <button
                  type="button"
                  className={`${styles['swap-complete-btn']} ${styles['swap-complete-btn-ghost']}`}
                  onClick={() => {
                    navigate("/swap/details", { state: { swapDetails: swapComplete } });
                    setSwapComplete(null);
                  }}
                >
                  {t(lang, 'swapSeeDetails')}
                </button>
                <button
                  type="button"
                  className={`${styles['swap-complete-btn']} ${styles['swap-complete-btn-primary']}`}
                  onClick={() => setSwapComplete(null)}
                >
                  {t(lang, 'swapDone')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ===========================================================================
// TokenBadge — inline token display for selector button
// ===========================================================================

function TokenBadge({ token, getTokenLogo }) {
  if (!token) {
    return (
      <span className={styles['select-token']}>
        SELECT TOKEN
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles['dropdown-arrow-minimal']}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </span>
    );
  }
  const logo = getTokenLogo(token);
  return (
    <>
      {logo ? (
        <img src={logo} alt={`${token.symbol} logo`} className={styles['token-logo-mini']} />
      ) : (
        <span className={styles['token-icon-mini']}>{token.symbol?.charAt(0).toUpperCase()}</span>
      )}
      <span className={styles['token-symbol']}>{token.symbol}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles['dropdown-arrow-minimal']}>
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </>
  );
}

// ===========================================================================
// TokenSelectorPanel — modal for picking a token
// ===========================================================================

function TokenSelectorPanel({ selectedToken, onSelect, onClose, excludeToken, tokens, getTokenLogo, lang }) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTokens = useMemo(() => {
    if (!searchQuery) return tokens;
    const q = searchQuery.toLowerCase();
    return tokens.filter(
      (t) => t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q)
    );
  }, [tokens, searchQuery]);

  return (
    <div className={styles['token-selector-overlay']} onClick={onClose}>
      <div className={styles['token-selector-panel']} onClick={(e) => e.stopPropagation()}>
        <div className={styles['token-selector-header']}>
          <h3>{t(lang, 'swapSelectToken')}</h3>
          <button className={styles['close-btn']} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles['token-search']}>
          <input
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles['token-list']}>
          {filteredTokens.length === 0 ? (
            <div className={styles['empty-tokens']}>{searchQuery ? t(lang, 'swapNoTokensMatch') : t(lang, 'swapNoTokensMatch')}</div>
          ) : (
            filteredTokens.map((token) => {
              const isSelected = selectedToken?.id === token.id;
              const isExcluded = excludeToken?.id === token.id;
              const logo = getTokenLogo(token);

              return (
                <div
                  key={token.id}
                  className={`${styles['token-option']} ${isSelected ? styles['selected'] : ""} ${isExcluded ? styles['disabled'] : ""}`}
                  onClick={() => {
                    if (!isExcluded) {
                      onSelect(token);
                      onClose();
                    }
                  }}
                >
                  <div className={styles['token-option-left']}>
                    {logo ? (
                      <img src={logo} alt={`${token.symbol} logo`} className={styles['token-logo-small']} />
                    ) : (
                      <div className={styles['token-icon-small']}>{token.symbol?.charAt(0).toUpperCase() || "?"}</div>
                    )}
                    <div className={styles['token-option-info']}>
                      <div className={styles['token-option-symbol']}>{token.symbol}</div>
                      <div className={styles['token-option-name']}>{token.name}</div>
                    </div>
                  </div>
                  <div className={styles['token-option-right']}>
                    <div className={styles['token-option-balance']}>{token.amount}</div>
                    {token.price > 0 && <div className={styles['token-option-value']}>${token.usdValue?.toFixed(2)}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default Swap;
