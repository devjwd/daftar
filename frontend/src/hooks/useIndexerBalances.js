/**
 * Hook for fetching token balances using Movement Indexer
 * More efficient than RPC calls for portfolio tracking
 */

import { useState, useEffect, useCallback } from "react";
import { getUserTokenBalances } from "../services/indexer";
import { getTokenInfo } from "../config/tokens";

const normalizeAssetAddress = (value) => {
  if (!value) return "";

  let normalized = String(value).trim().toLowerCase();
  const genericMatch = normalized.match(/<\s*([^>]+)\s*>/);
  if (genericMatch?.[1]) {
    normalized = genericMatch[1].trim().toLowerCase();
  }

  if (normalized.includes("::")) {
    normalized = normalized.split("::")[0];
  }

  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }

  const compact = normalized.slice(2).replace(/^0+/, "") || "0";
  return `0x${compact}`;
};

const isNativeMoveAsset = (assetType, metadata) => {
  const type = String(assetType || "").toLowerCase();
  const symbol = String(metadata?.symbol || "").toUpperCase();
  const name = String(metadata?.name || "").trim().toLowerCase();

  return (
    type === "0x1" ||
    type === "0xa" ||
    type.includes("::aptos_coin::aptoscoin") ||
    symbol === "MOVE" ||
    name === "movement"
  );
};

export const useIndexerBalances = (address) => {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBalances = useCallback(async () => {
    if (!address) {
      setBalances([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch from indexer (more efficient than RPC)
      const indexerBalances = await getUserTokenBalances(address);

      // Transform indexer data to match our balance format
      const processed = indexerBalances
        .map((item) => {
          try {
            const assetType = String(item.asset_type || "");
            const assetAddress = normalizeAssetAddress(assetType);
            let tokenInfo = getTokenInfo(assetAddress) || getTokenInfo(assetType);
            
            // Use metadata from indexer if available
            const hasMetadata = Boolean(item.metadata?.symbol);
            const nativeMove = Boolean(tokenInfo?.isNative) || (!tokenInfo && isNativeMoveAsset(assetType, item.metadata));
            
            // Fallback classification for native MOVE if registry lookup misses.
            if (!tokenInfo && nativeMove) {
              tokenInfo = {
                symbol: "MOVE",
                name: "Movement",
                decimals: 8,
                address: assetAddress || "0x1",
                isNative: true,
                verified: true,
              };
            }
            
            // Determine token metadata - prioritize indexer metadata, then registry, then defaults
            const symbol = nativeMove
              ? "MOVE"
              : (hasMetadata ? item.metadata.symbol : (tokenInfo?.symbol || "Unknown"));
            const name = nativeMove
              ? "Movement"
              : (hasMetadata ? item.metadata.name : (tokenInfo?.name || symbol));
            const decimals = hasMetadata && item.metadata.decimals !== undefined 
              ? item.metadata.decimals 
              : (tokenInfo?.decimals || 8);
            
            // Token is "known" if it's in our registry
            const isKnown = !!tokenInfo;
            
            const amount = BigInt(item.amount || "0");
            const divisor = BigInt(10) ** BigInt(decimals);
            const quantity = Number(amount) / Number(divisor);

            if (quantity <= 0) {
              return null;
            }

            // Smart formatting for different token types
            const isHighValueToken = ['BTC', 'WBTC', 'ETH', 'WETH'].includes(symbol?.toUpperCase());
            
            let formattedAmount;
            if (isHighValueToken && quantity < 0.01) {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 8,
              });
            } else if (isHighValueToken && quantity < 1) {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              });
            } else {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              });
            }

            return {
              id: assetType,
              fullType: assetType,
              address: tokenInfo?.address || assetAddress,
              name: name,
              symbol: symbol,
              amount: formattedAmount,
              numericAmount: quantity,
              rawAmount: item.amount,
              decimals,
              lastTransactionTimestamp: item.last_transaction_timestamp,
              isKnown: isKnown,
              metadata: item.metadata,
              isNative: Boolean(tokenInfo?.isNative || nativeMove),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.numericAmount - a.numericAmount);

      setBalances(processed);
    } catch (err) {
      setError(err.message || "Failed to fetch balances from indexer");
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return { balances, loading, error, refetch: fetchBalances };
};

