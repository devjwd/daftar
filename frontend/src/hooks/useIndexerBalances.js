/**
 * Hook for fetching token balances using Movement Indexer
 * More efficient than RPC calls for portfolio tracking
 */

import { useState, useEffect, useCallback } from "react";
import { getUserTokenBalances } from "../services/indexer";
import { getTokenInfo } from "../config/tokens";

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
            // Indexer returns asset_type as the token address directly
            // e.g., "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376"
            const assetAddress = item.asset_type?.toLowerCase() || "";
            
            // Use metadata from indexer if available
            const hasMetadata = item.metadata && item.metadata.symbol;
            
            // Look up token info from our registry by address
            // Try both original case and lowercase
            let tokenInfo = getTokenInfo(assetAddress) || getTokenInfo(item.asset_type);
            
            // If not found, check if it's the native MOVE token
            // The indexer might return "0xa" or the full address for native MOVE
            if (!tokenInfo && (assetAddress === "0xa" || assetAddress === "0x1" || 
                (hasMetadata && item.metadata.symbol === "MOVE"))) {
              tokenInfo = {
                symbol: "MOVE",
                name: "Movement",
                decimals: 8,
                address: assetAddress,
                isNative: true,
              };
            }
            
            // Determine token metadata - prioritize indexer metadata, then registry, then defaults
            const symbol = hasMetadata ? item.metadata.symbol : (tokenInfo?.symbol || 'Unknown');
            const name = hasMetadata ? item.metadata.name : (tokenInfo?.name || symbol);
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
              id: item.asset_type,
              fullType: item.asset_type,
              address: assetAddress,
              name: name,
              symbol: symbol,
              amount: formattedAmount,
              numericAmount: quantity,
              rawAmount: item.amount,
              lastTransactionTimestamp: item.last_transaction_timestamp,
              isKnown: isKnown,
              metadata: item.metadata,
            };
          } catch (e) {
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

