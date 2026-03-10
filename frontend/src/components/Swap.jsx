import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { DEFAULT_NETWORK } from "../config/network";
import { getSwapSettings, updateSwapSettings } from "../services/adminService";
import {
  clampSlippagePercent,
  normalizeMosaicSwapSettings,
  slippageToBps,
  fetchMosaicQuote,
  buildMosaicSwapPayload,
} from "../services/mosaicSwapService";
import { getTokenDecimals } from "../utils/tokenUtils";
import { getTokenInfo, getSwapAssetTypeBySymbol, MOVEMENT_TOKENS } from "../config/tokens";
import { TOKEN_VISUALS } from "../config/display";
import { useTokenPrices } from "../hooks/useTokenPrices";
import "./Swap.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SLIPPAGE = 0.5;
const DEFAULT_DECIMALS = 8;
const QUOTE_DEBOUNCE_MS = 600;
const AUTO_QUOTE_INTERVAL_MS = 10000;
const SUCCESS_DISMISS_MS = 6000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";
const QUOTE_MAX_AGE_MS = 30000;
const AMOUNT_INPUT_PATTERN = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
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
  return `≈ $${val.toFixed(2)}`;
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
  if (payload.typeArguments.length > 10 || payload.functionArguments.length > 30) return false;

  return true;
};

// ===========================================================================
// Swap Component
// ===========================================================================

const Swap = ({ balances }) => {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const { prices: priceMap } = useTokenPrices();
  const [swapSettings, setSwapSettings] = useState(() => normalizeMosaicSwapSettings(getSwapSettings()));

  // ---- State ----
  const [fromToken, setFromToken] = useState(null);
  const [toToken, setToToken] = useState(null);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [slippage, setSlippage] = useState(swapSettings.defaultSlippagePercent || DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [priceImpact, setPriceImpact] = useState(0);
  const [isQuoting, setIsQuoting] = useState(false);
  const [routingResult, setRoutingResult] = useState(null);

  const abortRef = useRef(null);

  const routeSettings = useMemo(() => ({ ...swapSettings }), [swapSettings]);

  // ---- Derived ----

  const movementClient = useMemo(
    () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: DEFAULT_NETWORK.rpc })),
    []
  );

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
      priceMap[addr],
      priceMap[String(token.address || "").toLowerCase()],
      priceMap[fullType],
    ];

    if (symbol === "MOVE") {
      directCandidates.push(priceMap["0xa"], priceMap["0x1"]);
    }

    for (const candidate of directCandidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }

    // Stablecoins are displayed as $1 fallback when market price is unavailable.
    if (symbol === "USDC" || symbol === "USDT") {
      return 1;
    }

    return 0;
  }, [priceMap]);

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

    return Array.from(tokensMap.values());
  }, [balances]);

  // ---- Quote Fetching (Mosaic) ----

  const fetchQuote = useCallback(async () => {
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

      // Direct Mosaic API quote
      const result = await fetchMosaicQuote({
        fromToken,
        toToken,
        amount: amountInSmallest,
        sender: senderAddress,
        slippageBps: slippageToBps(slippage),
        settings: routeSettings,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setRoutingResult(result);

      if (result.best) {
        const outputValue = Number(result.best.outputAmount || 0);
        const displayAmount = String(result.best.outputDisplayAmount || outputValue.toFixed(6));
        setToAmount(displayAmount);

        devLog("✅ Mosaic route:", result.selectedSource, "→", outputValue);

        // Calculate price impact
        const fromPrice = fromToken.price || priceMap[fromToken.address] || 0;
        const toPrice = toToken.price || priceMap[toToken.address] || 0;
        if (fromPrice > 0 && toPrice > 0) {
          const expectedOut = (parseFloat(fromAmount) * fromPrice) / toPrice;
          const impact = ((expectedOut - outputValue) / expectedOut) * 100;
          setPriceImpact(Math.max(0, impact));
        } else {
          setPriceImpact(result.best.priceImpact || 0);
        }
      } else if (result.error) {
        // Fallback: price-based estimate
        const fromPrice = fromToken.price || priceMap[fromToken.address] || 0;
        const toPrice = toToken.price || priceMap[toToken.address] || 0;
        if (fromPrice > 0 && toPrice > 0) {
          const estimated = ((parseFloat(fromAmount) * fromPrice) / toPrice) * 0.997;
          setToAmount(estimated.toFixed(6));
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
  }, [fromToken, toToken, fromAmount, slippage, account, getDecimals, priceMap, routeSettings]);

  // Debounced quote fetch
  useEffect(() => {
    const timer = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Auto re-quote every 10s while a valid pair/amount is selected.
  useEffect(() => {
    const hasValidQuoteInput =
      Boolean(fromToken) &&
      Boolean(toToken) &&
      fromToken?.id !== toToken?.id &&
      Boolean(fromAmount) &&
      parseFloat(fromAmount) > 0;

    if (!hasValidQuoteInput) return undefined;

    const interval = setInterval(() => {
      fetchQuote();
    }, AUTO_QUOTE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fromToken, toToken, fromAmount, fetchQuote]);

  // Cleanup
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep selected tokens valid if balances/token list changes.
  useEffect(() => {
    const availableIds = new Set(availableTokens.map((token) => token.id));

    if (fromToken && !availableIds.has(fromToken.id)) {
      setFromToken(null);
    }
    if (toToken && !availableIds.has(toToken.id)) {
      setToToken(null);
    }
  }, [availableTokens, fromToken, toToken]);

  // Auto-dismiss success
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [success]);

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
    if (!connected || !account) return setError("Please connect your wallet");
    if (!signAndSubmitTransaction) return setError("Wallet does not support transactions");
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
    setSuccess(null);
    setTxHash(null);

    try {
      const payload = buildMosaicSwapPayload(routingResult.best.quoteData);
      if (!isValidSwapPayload(payload)) throw new Error("Invalid swap payload. Please refresh quote.");

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
        setTxHash(response.hash);
        devLog("📝 Transaction:", response.hash);

        const txResult = await movementClient.waitForTransaction({
          transactionHash: response.hash,
          options: { timeoutSecs: 30 },
        });

        if (txResult.success) {
          setSuccess(`Swapped ${fromAmount} ${fromToken.symbol} for ~${toAmount} ${toToken.symbol}`);
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
      if (msg.includes("rejected") || msg.includes("denied")) {
        setError("Transaction rejected by user");
      } else if (msg.includes("insufficient") || msg.includes("balance")) {
        setError("Insufficient balance");
      } else if (msg.includes("slippage") || msg.includes("INSUFFICIENT_OUTPUT")) {
        setError("Price moved unfavorably. Try increasing slippage.");
      } else {
        setError(msg.substring(0, 120) || "Swap failed. Please try again.");
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
    if (bestSource === "mosaic") return "Mosaic";
    return "-";
  }, [bestSource]);

  const buttonState = useMemo(() => {
    if (swapping) return { text: "Swapping...", disabled: true };
    if (!connected) return { text: "Connect Wallet", disabled: true };
    if (!fromToken || !toToken) return { text: "Select Tokens", disabled: true };
    if (fromToken.id === toToken.id) return { text: "Select Different Tokens", disabled: true };
    if (!fromAmount || parseFloat(fromAmount) <= 0) return { text: "Enter Amount", disabled: true };
    if (parseFloat(fromAmount) > (fromToken.numericAmount || 0)) return { text: "Insufficient Balance", disabled: true };
    if (isQuoting) return { text: "Getting Mosaic Quote...", disabled: true };
    if (!routingResult?.best) return { text: "No Route Available", disabled: true };
    return { text: "Swap on Mosaic", disabled: false };
  }, [swapping, connected, fromToken, toToken, fromAmount, isQuoting, routingResult]);

  const minReceived = useMemo(() => {
    const output = parseFloat(toAmount) || 0;
    return (output * (1 - slippage / 100)).toFixed(6);
  }, [toAmount, slippage]);

  // ---- Settings Modal ----

  const renderSettings = () => {
    if (!showSettings) return null;
    const presetSlippages = [0.1, 0.5, 1.0, 3.0];

    return (
      <div className="settings-overlay" onClick={() => setShowSettings(false)}>
        <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <div className="settings-header-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="settings-icon">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor"/>
              </svg>
              <div className="settings-title-group">
                <h3>Swap Settings</h3>
                <p className="settings-subtitle">Mosaic execution controls</p>
              </div>
            </div>
            <button className="close-btn" onClick={() => setShowSettings(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="settings-body">
            <div className="settings-section">
              <div className="settings-section-head">
                <label>Slippage Tolerance</label>
                <span className="settings-hint">Current: {slippage}%</span>
              </div>
              <div className="slippage-options">
                {presetSlippages.map((v) => (
                  <button
                    key={v}
                    className={`slippage-btn ${Math.abs(slippage - v) < 0.001 ? "active" : ""}`}
                    onClick={() => setSlippage(v)}
                  >
                    {v}%
                  </button>
                ))}
              </div>
              <div className="slippage-custom-row">
                <div className="slippage-custom">
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
                <div className="slippage-warning">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z" />
                  </svg>
                  High slippage may result in unfavorable execution.
                </div>
              )}
            </div>

            <div className="settings-section aggregator-section">
              <div className="settings-section-head">
                <label>Aggregator</label>
                <span className="settings-hint">Provider: 1/1</span>
              </div>

              <div className="aggregator-panel">
                <div className="aggregator-panel-head">
                  <span>Mosaic is the fixed aggregator for all swaps.</span>
                </div>

                <div className="aggregator-list" role="list">
                  <div className="aggregator-row">
                    <span className="aggregator-label">Mosaic</span>
                    <span className="aggregator-badge">Active</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-footer">
              <button className="settings-reset-btn" onClick={() => setSlippage(swapSettings.defaultSlippagePercent || DEFAULT_SLIPPAGE)}>
                Reset
              </button>
              <button
                className="settings-save-btn"
                onClick={() => {
                  const next = updateSwapSettings({
                    defaultSlippagePercent: slippage,
                  });
                  setSwapSettings(normalizeMosaicSwapSettings(next));
                  setShowSettings(false);
                }}
              >
                Done
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
    <div className="swap-container">
      <div className="swap-card">
          {/* Header */}
          <div className="swap-header">
            <div className="swap-header-left">
              <h2>Swap</h2>
              <p className="swap-subtitle">Mosaic swap on Movement Network</p>
            </div>
            <div className="swap-header-actions">
              <button
                className={`quote-btn ${isQuoting ? "quoting" : ""}`}
                onClick={fetchQuote}
                title="Instant Quote"
                disabled={!canRequestInstantQuote}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3a9 9 0 1 0 8.94 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="settings-btn" onClick={() => setShowSettings(true)} title="Settings">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          {/* Connect Prompt */}
          {!connected && (
            <div className="swap-connect-prompt">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="connect-icon">
                <circle cx="12" cy="5" r="3" />
                <path d="M12 13v6M6 15l-3-2M18 15l3-2M8 17H4v2c0 1.1.9 2 2 2h2M20 17h4v2c0 1.1-.9 2-2 2h-2" />
                <line x1="12" y1="13" x2="12" y2="18" />
              </svg>
              <p>Connect your wallet to start swapping</p>
            </div>
          )}

          {/* Empty State */}
          {connected && availableTokens.length === 0 && (
            <div className="swap-empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
                <path d="M8 6h12M8 10h12M8 14h8M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                <circle cx="6" cy="18" r="3" fill="none" />
                <circle cx="18" cy="18" r="3" fill="none" />
              </svg>
              <p>No tokens available to swap</p>
              <span className="empty-hint">Deposit tokens to your wallet first</span>
            </div>
          )}

          {/* Main Swap Interface */}
          {connected && availableTokens.length > 0 && (
            <>
              {/* From Token Input */}
              <div className="swap-input-group">
                <div className="swap-input-label">
                  <span>From</span>
                  {fromToken && <span className="swap-balance">Balance: {fromToken.amount}</span>}
                </div>
                <div className="swap-input-container">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="swap-input"
                    placeholder="0.0"
                    value={fromAmount}
                    onChange={handleAmountChange}
                  />
                  <div className="swap-input-right">
                    <div className="quick-fill-group" aria-label="Quick amount selector">
                      <button type="button" className="quick-fill-btn" onClick={() => handlePercentClick(25)}>25%</button>
                      <span className="quick-fill-separator" aria-hidden="true">-</span>
                      <button type="button" className="quick-fill-btn" onClick={() => handlePercentClick(50)}>50%</button>
                      <span className="quick-fill-separator" aria-hidden="true">-</span>
                      <button type="button" className="quick-fill-btn" onClick={() => handlePercentClick(100)}>100%</button>
                    </div>
                    <button className="swap-token-selector" onClick={() => setShowFromSelector(true)}>
                      <TokenBadge token={fromToken} getTokenLogo={getTokenLogo} />
                    </button>
                  </div>
                </div>
                {fromToken && fromAmount && (
                  <div className="swap-input-footer">
                    <span className="swap-usd-value">{formatUsd(fromAmount, resolveTokenPrice(fromToken))}</span>
                  </div>
                )}
              </div>

              {/* Swap Direction Button */}
              <div className="swap-switch-container">
                <button className="swap-switch-btn" onClick={handleSwapTokens} title="Switch tokens">
                  <span className="swap-switch-icon">⇅</span>
                </button>
              </div>

              {/* To Token Input */}
              <div className="swap-input-group">
                <div className="swap-input-label">
                  <span>To (estimated)</span>
                  {toToken && <span className="swap-balance">Balance: {toToken.amount}</span>}
                </div>
                <div className="swap-input-container">
                  <input
                    type="text"
                    className="swap-input"
                    placeholder="0.0"
                    value={isQuoting ? "..." : toAmount}
                    readOnly
                  />
                  <div className="swap-input-right">
                    <button className="swap-token-selector" onClick={() => setShowToSelector(true)}>
                      <TokenBadge token={toToken} getTokenLogo={getTokenLogo} />
                    </button>
                  </div>
                </div>
                {toToken && toAmount && (
                  <div className="swap-input-footer">
                    <span className="swap-usd-value">{formatUsd(toAmount, resolveTokenPrice(toToken))}</span>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="swap-error">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="error-icon">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z" />
                  </svg>
                  {error}
                </div>
              )}

              {/* Success */}
              {success && (
                <div className="swap-success">
                  <span className="success-icon">✅</span>
                  {success}
                  {txHash && (
                    <a
                      href={`${DEFAULT_NETWORK.explorer}/txn/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View Transaction ↗
                    </a>
                  )}
                </div>
              )}

              {/* Swap Button */}
              <button
                className={`swap-execute-btn ${buttonState.disabled ? "disabled" : ""}`}
                onClick={handleSwap}
                disabled={buttonState.disabled}
              >
                {swapping && <span className="spinner" />}
                {buttonState.text}
              </button>

              {/* Swap Details */}
              {fromToken && toToken && fromAmount && toAmount && !error && (
                <div className="swap-info">
                  <div className="swap-info-row">
                    <span>Rate</span>
                    <span>
                      1 {fromToken.symbol} = {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(6)} {toToken.symbol}
                    </span>
                  </div>
                  <div className="swap-info-row">
                    <span>Price Impact</span>
                    <span className={priceImpact > 3 ? "warning" : ""}>~{priceImpact.toFixed(2)}%</span>
                  </div>
                  <div className="swap-info-row">
                    <span>Min. Received</span>
                    <span>{minReceived} {toToken.symbol}</span>
                  </div>
                  <div className="swap-info-row">
                    <span>Slippage</span>
                    <span>{slippage}%</span>
                  </div>
                  <div className="swap-info-row">
                    <span>Network Fee</span>
                    <span>~0.001 MOVE</span>
                  </div>
                  <div className="swap-info-row highlight">
                    <span>Route</span>
                    <span className="mosaic-router">
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
        />
      )}

      {/* Settings Modal */}
      {renderSettings()}
    </div>
  );
};

// ===========================================================================
// TokenBadge — inline token display for selector button
// ===========================================================================

function TokenBadge({ token, getTokenLogo }) {
  if (!token) return <span className="select-token">Select ▼</span>;
  const logo = getTokenLogo(token);
  return (
    <>
      {logo ? (
        <img src={logo} alt={`${token.symbol} logo`} className="token-logo-mini" />
      ) : (
        <span className="token-icon-mini">{token.symbol?.charAt(0).toUpperCase()}</span>
      )}
      <span className="token-symbol">{token.symbol}</span>
      <span className="dropdown-arrow">▼</span>
    </>
  );
}

// ===========================================================================
// TokenSelectorPanel — modal for picking a token
// ===========================================================================

function TokenSelectorPanel({ selectedToken, onSelect, onClose, excludeToken, tokens, getTokenLogo }) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTokens = useMemo(() => {
    if (!searchQuery) return tokens;
    const q = searchQuery.toLowerCase();
    return tokens.filter(
      (t) => t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q)
    );
  }, [tokens, searchQuery]);

  return (
    <div className="token-selector-overlay" onClick={onClose}>
      <div className="token-selector-panel" onClick={(e) => e.stopPropagation()}>
        <div className="token-selector-header">
          <h3>Select Token</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="token-search">
          <input
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="token-list">
          {filteredTokens.length === 0 ? (
            <div className="empty-tokens">{searchQuery ? "No tokens match" : "No tokens available"}</div>
          ) : (
            filteredTokens.map((token) => {
              const isSelected = selectedToken?.id === token.id;
              const isExcluded = excludeToken?.id === token.id;
              const logo = getTokenLogo(token);

              return (
                <div
                  key={token.id}
                  className={`token-option ${isSelected ? "selected" : ""} ${isExcluded ? "disabled" : ""}`}
                  onClick={() => {
                    if (!isExcluded) {
                      onSelect(token);
                      onClose();
                    }
                  }}
                >
                  <div className="token-option-left">
                    {logo ? (
                      <img src={logo} alt={`${token.symbol} logo`} className="token-logo-small" />
                    ) : (
                      <div className="token-icon-small">{token.symbol?.charAt(0).toUpperCase() || "?"}</div>
                    )}
                    <div className="token-option-info">
                      <div className="token-option-symbol">{token.symbol}</div>
                      <div className="token-option-name">{token.name}</div>
                    </div>
                  </div>
                  <div className="token-option-right">
                    <div className="token-option-balance">{token.amount}</div>
                    {token.price > 0 && <div className="token-option-value">${token.usdValue?.toFixed(2)}</div>}
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