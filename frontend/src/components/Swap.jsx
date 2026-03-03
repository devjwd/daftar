import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { DEFAULT_NETWORK, MOSAIC_CONFIG } from "../config/network";
import { getSwapSettings } from "../services/adminService";
import { getTokenDecimals } from "../utils/tokenUtils";
import { getTokenInfo, getSwapAssetTypeBySymbol, MOVEMENT_TOKENS } from "../config/tokens";
import { TOKEN_VISUALS } from "../config/display";
import { useTokenPrices } from "../hooks/useTokenPrices";
import "./Swap.css";

/**
 * =============================================================================
 * MOSAIC DEX AGGREGATOR INTEGRATION
 * =============================================================================
 * 
 * Mosaic is the leading DEX aggregator on Movement Network.
 * It routes trades through multiple liquidity sources for best execution.
 * 
 * API Documentation: https://docs.mosaic.ag/swap-integration/api
 * 
 * API Endpoint: GET https://api.mosaic.ag/v1/quote
 * 
 * Query Parameters:
 * - srcAsset: Source token address (e.g., "0x1::aptos_coin::AptosCoin")
 * - dstAsset: Destination token address
 * - amount: Amount in smallest units (e.g., 100000000 for 1 MOVE)
 * - slippage: Slippage tolerance (e.g., "0.5" for 0.5%)
 * - sender: Sender wallet address
 * - receiver: Receiver wallet address (usually same as sender)
 * 
 * Response includes transaction payload ready to submit:
 * - tx.function: Full function path (e.g., "0xede...::router::swap")
 * - tx.typeArguments: Type arguments for the swap
 * - tx.functionArguments: Function arguments including amounts
 */

const MOSAIC_API = {
  baseUrl: MOSAIC_CONFIG.apiUrl,
  quoteEndpoint: "/quote",
  routerAddress: MOSAIC_CONFIG.routerAddress,
  swapFunction: "router::swap",
};

const MOSAIC_API_KEY = import.meta.env.VITE_MOSAIC_API_KEY;

const DEFAULT_SLIPPAGE = 0.5;
const DEFAULT_DECIMALS = 8;

const devLog = (...args) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
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
  if (raw.includes("::")) return raw.split("::")[0];
  return raw;
};

const Swap = ({ balances }) => {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const { prices: priceMap } = useTokenPrices();
  
  const [fromToken, setFromToken] = useState(null);
  const [toToken, setToToken] = useState(null);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [priceImpact, setPriceImpact] = useState(0);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteData, setQuoteData] = useState(null);
  const [route, setRoute] = useState(null);
  const quoteAbortController = useRef(null);
  const [swapSettings] = useState(() => {
    try {
      return getSwapSettings();
    } catch {
      return { protocolFeeBps: 0, referrer: "" };
    }
  });

  const movementClient = useMemo(() => 
    new Aptos(new AptosConfig({
      network: Network.CUSTOM,
      fullnode: DEFAULT_NETWORK.rpc
    })), []);

  /**
   * Get token decimals
   */
  const getDecimals = useCallback((token) => {
    if (!token) return DEFAULT_DECIMALS;
    return token.decimals || getTokenDecimals(token.fullType || token.address) || DEFAULT_DECIMALS;
  }, []);

  /**
   * Calculate minimum output with slippage
   */
  const calculateMinOutput = useCallback((output, slippagePercent) => {
    return output * (1 - slippagePercent / 100);
  }, []);

  /**
   * Convert amount to smallest unit
   */
  const toSmallestUnit = useCallback((amount, decimals) => {
    if (!amount || isNaN(parseFloat(amount))) return "0";
    const value = parseFloat(amount) * Math.pow(10, decimals);
    return Math.floor(value).toString();
  }, []);

  /**
   * Get full token address/type for API
   */
  const getTokenType = useCallback((token) => {
    if (!token) return null;

    // Prefer full type from balance data when available
    if (token.fullType && String(token.fullType).includes("::")) {
      return token.fullType;
    }

    // Resolve by normalized symbol (supports ETH/BTC and .e forms)
    const symbol = normalizeTokenSymbol(token.symbol);
    const swapType = getSwapAssetTypeBySymbol(symbol);
    if (swapType) return swapType;

    // Use address when it is already a full type
    if (token.address && String(token.address).includes("::")) {
      return token.address;
    }

    // Last-resort fallback for unknown tokens
    return token.address || null;
  }, []);

  const getTokenLogo = useCallback((token) => {
    const symbol = normalizeTokenSymbol(token?.symbol);
    if (!symbol) return null;
    return TOKEN_VISUALS[symbol]?.logo || null;
  }, []);

  // Available tokens from user's balance - filtered to only verified tokens
  // Also includes all verified tokens from registry even if user has no balance
  const availableTokens = useMemo(() => {
    const tokensMap = new Map();
    const registryBySymbol = new Map(
      Object.values(MOVEMENT_TOKENS).map((tokenInfo) => [normalizeTokenSymbol(tokenInfo.symbol), tokenInfo])
    );
    
    // First, add all verified tokens from MOVEMENT_TOKENS registry
    Object.entries(MOVEMENT_TOKENS).forEach(([, tokenInfo]) => {
      if (tokenInfo.verified && tokenInfo.symbol) {
        // Skip duplicate MOVE entries (0x1 and 0xa are the same token)
        if (tokenInfo.symbol === 'MOVE' && tokensMap.has('MOVE')) {
          return;
        }
        
        const tokenId = tokenInfo.symbol;
        tokensMap.set(tokenId, {
          id: tokenId,
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
      }
    });
    
    // Then overlay user's actual balances
    if (balances && balances.length > 0) {
      balances.forEach(balance => {
        const extractedAddress = extractAddressFromType(balance.address || balance.fullType);
        const normalizedSymbol = normalizeTokenSymbol(balance.symbol);
        const tokenInfo = getTokenInfo(extractedAddress) || registryBySymbol.get(normalizedSymbol);

        if (tokenInfo?.verified && balance.symbol) {
          const balanceFullType = String(balance.fullType || "");
          const resolvedType = balanceFullType.includes("::")
            ? balanceFullType
            : getSwapAssetTypeBySymbol(normalizedSymbol) || extractedAddress;

          tokensMap.set(tokenInfo.symbol || balance.symbol, {
            ...balance,
            id: tokenInfo.symbol || balance.symbol,
            symbol: tokenInfo.symbol || balance.symbol,
            address: extractedAddress || tokenInfo.address,
            fullType: resolvedType,
            decimals: tokenInfo.decimals || balance.decimals,
          });
        }
      });
    }
    
    return Array.from(tokensMap.values());
  }, [balances]);

  /**
   * Fetch quote from Mosaic API
   */
  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount("");
      setPriceImpact(0);
      setQuoteData(null);
      setRoute(null);
      return;
    }

    if (fromToken.id === toToken.id) {
      setToAmount("");
      setError("Cannot swap the same token");
      return;
    }

    // Abort previous request
    if (quoteAbortController.current) {
      quoteAbortController.current.abort();
    }
    quoteAbortController.current = new AbortController();

    setIsQuoting(true);
    setError(null);

    try {
      const srcAsset = getTokenType(fromToken);
      const dstAsset = getTokenType(toToken);
      if (!srcAsset || !dstAsset || !String(srcAsset).includes("::") || !String(dstAsset).includes("::")) {
        throw new Error("Unsupported token route for selected pair");
      }
      const fromDecimals = getDecimals(fromToken);
      const amountInSmallest = toSmallestUnit(fromAmount, fromDecimals);
      const senderAddress = account?.address?.toString() || "";

      const protocolFeeBps = Number(swapSettings.protocolFeeBps || 0);
      const referrer = (swapSettings.referrer || "").trim();

      devLog("🔄 Fetching Mosaic quote:", {
        from: `${fromAmount} ${fromToken.symbol}`,
        to: toToken.symbol,
        srcAsset,
        dstAsset,
        amount: amountInSmallest,
      });

      // Build API URL
      const params = new URLSearchParams({
        srcAsset,
        dstAsset,
        amount: amountInSmallest,
        slippage: slippage.toString(),
        sender: senderAddress,
        receiver: senderAddress,
      });

      if (protocolFeeBps > 0) {
        params.set("protocolFeeBps", String(protocolFeeBps));
      }
      if (referrer) {
        params.set("referrer", referrer);
      }

      const response = await fetch(
        `${MOSAIC_API.baseUrl}${MOSAIC_API.quoteEndpoint}?${params}`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            ...(MOSAIC_API_KEY ? { "x-api-key": MOSAIC_API_KEY } : {}),
          },
          signal: quoteAbortController.current.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Mosaic API error: ${response.statusText}`);
      }

      const result = await response.json();
      devLog("✅ Mosaic API response:", result);

      if (!result.data || !result.data.dstAmount) {
        throw new Error("Invalid Mosaic API response");
      }

      const data = result.data;
      const toDecimals = getDecimals(toToken);
      const outputValue = Number(data.dstAmount) / Math.pow(10, toDecimals);
      setToAmount(outputValue.toFixed(6));
      
      // Store full quote data for swap execution
      setQuoteData(data);
      
      // Calculate price impact
      const fromPrice = fromToken.price || priceMap[fromToken.address] || 0;
      const toPrice = toToken.price || priceMap[toToken.address] || 0;
      if (fromPrice > 0 && toPrice > 0) {
        const expectedOut = (parseFloat(fromAmount) * fromPrice) / toPrice;
        const actualOut = outputValue;
        const impact = ((expectedOut - actualOut) / expectedOut) * 100;
        setPriceImpact(Math.max(0, impact));
      }
      
      // Set route info
      if (data.paths && data.paths.length > 0) {
        const sources = data.paths.map(p => p.source).join(" → ");
        setRoute({ 
          type: "mosaic",
          via: "Mosaic Aggregator",
          sources: sources,
        });
      } else {
        setRoute({ type: "mosaic", via: "Mosaic Aggregator" });
      }


    } catch (err) {
      if (err.name === "AbortError") {
        return; // Ignore aborted requests
      }
      
      console.error("Quote error:", err);
      
      // Fallback to price-based calculation
      const fromPrice = fromToken.price || priceMap[fromToken.address] || 0;
      const toPrice = toToken.price || priceMap[toToken.address] || 0;
      
      if (fromPrice > 0 && toPrice > 0) {
        const inputValue = parseFloat(fromAmount) * fromPrice;
        const estimatedOutput = (inputValue / toPrice) * 0.997;
        setToAmount(estimatedOutput.toFixed(6));
        setPriceImpact(0.3);
        setRoute({ type: "estimate", via: "Price Oracle (Router unavailable)" });
      } else {
        setError("Unable to get quote. Please try again.");
      }
    } finally {
      setIsQuoting(false);
    }
  }, [fromToken, toToken, fromAmount, slippage, account, getTokenType, getDecimals, toSmallestUnit, priceMap, swapSettings]);

  // Debounced quote fetching
  useEffect(() => {
    const timer = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Set default tokens
  useEffect(() => {
    if (availableTokens.length > 0 && !fromToken) {
      setFromToken(availableTokens[0]);
    }
    if (availableTokens.length > 1 && !toToken) {
      setToToken(availableTokens[1]);
    } else if (availableTokens.length === 1 && !toToken) {
      setToToken(availableTokens[0]);
    }
  }, [availableTokens, fromToken, toToken]);

  // Clear success message after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  /**
   * Swap token positions
   */
  const handleSwapTokens = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
    setError(null);
    setQuoteData(null);
  };

  /**
   * Set max amount
   */
  const handleMaxClick = () => {
    if (fromToken && fromToken.numericAmount) {
      const isNative = fromToken.symbol === "MOVE" || fromToken.address === "0x1";
      const maxAmount = isNative ? Math.max(0, fromToken.numericAmount - 0.01) : fromToken.numericAmount;
      setFromAmount(maxAmount.toString());
      setError(null);
    }
  };

  /**
   * Execute swap via Mosaic
   */
  const handleSwap = async () => {
    if (!connected || !account) {
      setError("Please connect your wallet");
      return;
    }

    if (!signAndSubmitTransaction) {
      setError("Wallet does not support transactions");
      return;
    }

    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (fromToken.id === toToken.id) {
      setError("Cannot swap the same token");
      return;
    }

    if (parseFloat(fromAmount) > (fromToken.numericAmount || 0)) {
      setError("Insufficient balance");
      return;
    }

    setSwapping(true);
    setError(null);
    setSuccess(null);
    setTxHash(null);

    try {
      let payload;
      const fromDecimals = getDecimals(fromToken);
      const toDecimals = getDecimals(toToken);
      const amountIn = toSmallestUnit(fromAmount, fromDecimals);
      const minAmountOut = toSmallestUnit(
        calculateMinOutput(parseFloat(toAmount), slippage).toString(),
        toDecimals
      );

      // Execute via Mosaic only
      // If we have quote data from Mosaic API with tx info, use it
      if (quoteData?.tx) {
        devLog("🔄 Using Mosaic API transaction payload");
        payload = {
          function: quoteData.tx.function,
          typeArguments: quoteData.tx.typeArguments || [],
          functionArguments: quoteData.tx.functionArguments || [],
        };
      } else {
        // Fallback: Build transaction manually
        devLog("🔄 Building manual Mosaic swap transaction");
        const srcAsset = getTokenType(fromToken);
        const dstAsset = getTokenType(toToken);
        
        payload = {
          function: `${MOSAIC_API.routerAddress}::${MOSAIC_API.swapFunction}`,
          typeArguments: [srcAsset, dstAsset],
          functionArguments: [amountIn, minAmountOut],
        };
      }

      devLog("🔄 Executing swap:", {
        from: `${fromAmount} ${fromToken.symbol}`,
        to: `${toAmount} ${toToken.symbol}`,
        slippage: `${slippage}%`,
        payload,
      });

      const response = await signAndSubmitTransaction({
        sender: account.address,
        data: payload,
      });

      if (response?.hash) {
        setTxHash(response.hash);
        devLog("📝 Transaction submitted:", response.hash);
        
        const txResult = await movementClient.waitForTransaction({ 
          transactionHash: response.hash,
          options: { timeoutSecs: 30 }
        });

        if (txResult.success) {
          setSuccess(`Swapped ${fromAmount} ${fromToken.symbol} for ~${toAmount} ${toToken.symbol}`);
          setFromAmount("");
          setToAmount("");
          setQuoteData(null);
          devLog("✅ Swap successful!");
        } else {
          throw new Error("Transaction failed on-chain");
        }
      }
    } catch (err) {
      console.error("Swap error:", err);
      let errorMsg = "Swap failed. Please try again.";
      
      if (err.message?.includes("rejected") || err.message?.includes("denied")) {
        errorMsg = "Transaction rejected by user";
      } else if (err.message?.includes("insufficient") || err.message?.includes("balance")) {
        errorMsg = "Insufficient balance";
      } else if (err.message?.includes("slippage")) {
        errorMsg = "Slippage too high. Try increasing tolerance.";
      } else if (err.message?.includes("INSUFFICIENT_OUTPUT")) {
        errorMsg = "Price moved unfavorably. Try increasing slippage.";
      } else if (err.message) {
        errorMsg = err.message.substring(0, 100);
      }
      setError(errorMsg);
    } finally {
      setSwapping(false);
    }
  };

  // Settings Modal
  const SettingsModal = () => {
    if (!showSettings) return null;
    const presetSlippages = [0.1, 0.5, 1.0, 3.0];
    const setClampedSlippage = (value) => {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) return;
      setSlippage(Math.max(0.01, Math.min(50, parsed)));
    };

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
                <p className="settings-subtitle">Control routing and execution tolerance</p>
              </div>
            </div>
            <button className="close-btn" onClick={() => setShowSettings(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
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
                {presetSlippages.map((value) => (
                  <button
                    key={value}
                    className={`slippage-btn ${Math.abs(slippage - value) < 0.000001 ? "active" : ""}`}
                    onClick={() => setSlippage(value)}
                  >
                    {value}%
                  </button>
                ))}
              </div>
              <div className="slippage-custom-row">
                <div className="slippage-custom">
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setClampedSlippage(e.target.value)}
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
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z"/>
                  </svg>
                  High slippage may result in unfavorable execution.
                </div>
              )}
            </div>

            <div className="settings-footer">
              <button
                className="settings-reset-btn"
                onClick={() => {
                  setSlippage(DEFAULT_SLIPPAGE);
                }}
              >
                Reset
              </button>
              <button className="settings-save-btn" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Token Selector
  const TokenSelector = ({ selectedToken, onSelect, show, onClose, excludeToken }) => {
    const [searchQuery, setSearchQuery] = useState("");

    if (!show) return null;

    const filteredTokens = availableTokens.filter(token => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        token.symbol?.toLowerCase().includes(query) ||
        token.name?.toLowerCase().includes(query)
      );
    });

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
                
                return (
                  <div
                    key={token.id}
                    className={`token-option ${isSelected ? "selected" : ""} ${isExcluded ? "disabled" : ""}`}
                    onClick={() => {
                      if (!isExcluded) {
                        onSelect(token);
                        onClose();
                        setSearchQuery("");
                      }
                    }}
                  >
                    <div className="token-option-left">
                      {getTokenLogo(token) ? (
                        <img
                          src={getTokenLogo(token)}
                          alt={`${token.symbol} logo`}
                          className="token-logo-small"
                        />
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
                      {token.price > 0 && (
                        <div className="token-option-value">${token.usdValue?.toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  const getSwapButtonState = () => {
    if (swapping) return { text: "Swapping...", disabled: true };
    if (!connected) return { text: "Connect Wallet", disabled: true };
    if (!fromToken || !toToken) return { text: "Select Tokens", disabled: true };
    if (fromToken.id === toToken.id) return { text: "Select Different Tokens", disabled: true };
    if (!fromAmount || parseFloat(fromAmount) <= 0) return { text: "Enter Amount", disabled: true };
    if (parseFloat(fromAmount) > (fromToken.numericAmount || 0)) return { text: "Insufficient Balance", disabled: true };
    if (isQuoting) return { text: "Getting Quote...", disabled: true };
    return { text: "Swap via Mosaic", disabled: false };
  };

  const buttonState = getSwapButtonState();

  return (
    <div className="swap-container">
      <div className="swap-card">
        <div className="swap-header">
          <div className="swap-header-left">
            <h2>Swap</h2>
            <p className="swap-subtitle">Trade tokens on Movement Network</p>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)} title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor"/>
            </svg>
          </button>
        </div>

        {!connected && (
          <div className="swap-connect-prompt">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="connect-icon">
              <circle cx="12" cy="5" r="3"></circle>
              <path d="M12 13v6M6 15l-3-2M18 15l3-2M8 17H4v2c0 1.1.9 2 2 2h2M20 17h4v2c0 1.1-.9 2-2 2h-2"></path>
              <line x1="12" y1="13" x2="12" y2="18"></line>
            </svg>
            <p>Connect your wallet to start swapping</p>
          </div>
        )}

        {connected && availableTokens.length === 0 && (
          <div className="swap-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
              <path d="M8 6h12M8 10h12M8 14h8M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"></path>
              <circle cx="6" cy="18" r="3" fill="none"></circle>
              <circle cx="18" cy="18" r="3" fill="none"></circle>
            </svg>
            <p>No tokens available to swap</p>
            <span className="empty-hint">Deposit tokens to your wallet first</span>
          </div>
        )}

        {connected && availableTokens.length > 0 && (
          <>
            {/* From Token */}
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
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || /^\d*\.?\d*$/.test(val)) {
                      setFromAmount(val);
                      setError(null);
                    }
                  }}
                />
                <div className="swap-input-right">
                  <button className="max-btn" onClick={handleMaxClick}>MAX</button>
                  <button className="swap-token-selector" onClick={() => setShowFromSelector(true)}>
                    {fromToken ? (
                      <>
                        {getTokenLogo(fromToken) ? (
                          <img
                            src={getTokenLogo(fromToken)}
                            alt={`${fromToken.symbol} logo`}
                            className="token-logo-mini"
                          />
                        ) : (
                          <span className="token-icon-mini">{fromToken.symbol?.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="token-symbol">{fromToken.symbol}</span>
                        <span className="dropdown-arrow">▼</span>
                      </>
                    ) : (
                      <span className="select-token">Select ▼</span>
                    )}
                  </button>
                </div>
              </div>
              {fromToken && fromAmount && (
                <div className="swap-input-footer">
                  <span className="swap-usd-value">≈ ${((parseFloat(fromAmount) || 0) * (fromToken.price || 0)).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Swap Direction */}
            <div className="swap-switch-container">
              <button className="swap-switch-btn" onClick={handleSwapTokens} title="Switch tokens">
                <span className="swap-switch-icon">⇅</span>
              </button>
            </div>

            {/* To Token */}
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
                    {toToken ? (
                      <>
                        {getTokenLogo(toToken) ? (
                          <img
                            src={getTokenLogo(toToken)}
                            alt={`${toToken.symbol} logo`}
                            className="token-logo-mini"
                          />
                        ) : (
                          <span className="token-icon-mini">{toToken.symbol?.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="token-symbol">{toToken.symbol}</span>
                        <span className="dropdown-arrow">▼</span>
                      </>
                    ) : (
                      <span className="select-token">Select ▼</span>
                    )}
                  </button>
                </div>
              </div>
              {toToken && toAmount && (
                <div className="swap-input-footer">
                  <span className="swap-usd-value">≈ ${((parseFloat(toAmount) || 0) * (toToken.price || 0)).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="swap-error">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="error-icon">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z"/>
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
                  <a href={`${DEFAULT_NETWORK.explorer}/txn/${txHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">
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
              {swapping && <span className="spinner"></span>}
              {buttonState.text}
            </button>

            {/* Swap Info */}
            {fromToken && toToken && fromAmount && toAmount && !error && (
              <div className="swap-info">
                <div className="swap-info-row">
                  <span>Rate</span>
                  <span>1 {fromToken.symbol} = {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(6)} {toToken.symbol}</span>
                </div>
                <div className="swap-info-row">
                  <span>Price Impact</span>
                  <span className={priceImpact > 3 ? "warning" : ""}>~{priceImpact.toFixed(2)}%</span>
                </div>
                <div className="swap-info-row">
                  <span>Min. Received</span>
                  <span>{calculateMinOutput(parseFloat(toAmount), slippage).toFixed(6)} {toToken.symbol}</span>
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
                  <span>Router</span>
                  <span className="mosaic-router">
                    <span className="mosaic-icon">
                      {"🔷"}
                    </span>
                    {route?.via || "Mosaic Aggregator"}
                  </span>
                </div>
                {route?.sources && (
                  <div className="swap-info-row">
                    <span>Route</span>
                    <span className="route-path">{route.sources}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <TokenSelector
        selectedToken={fromToken}
        onSelect={setFromToken}
        show={showFromSelector}
        onClose={() => setShowFromSelector(false)}
        label="From Token"
        excludeToken={toToken}
      />

      <TokenSelector
        selectedToken={toToken}
        onSelect={setToToken}
        show={showToSelector}
        onClose={() => setShowToSelector(false)}
        label="To Token"
        excludeToken={fromToken}
      />

      <SettingsModal />
    </div>
  );
};

export default Swap;