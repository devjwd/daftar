/**
 * Hook for fetching token balances using Movement Indexer
 * More efficient than RPC calls for portfolio tracking
 */

import { useState, useEffect, useCallback } from "react";
import { getUserTokenBalances } from "../services/indexer";
import { getTokenInfo } from "../config/tokens";

const normalizeAssetAddress = (value: string): string => {
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

const isNativeMoveAsset = (assetType: string, metadata: any): boolean => {
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

export interface IndexerBalance {
  id: string;
  fullType: string;
  address: string;
  name: string;
  symbol: string;
  amount: string;
  numericAmount: number;
  rawAmount: string;
  decimals: number;
  lastTransactionTimestamp: string;
  isKnown: boolean;
  metadata: any;
  isNative: boolean;
  type: string;
}

const CACHE_PREFIX = "indexer_balances_";

const loadCachedBalances = (address: string | null): IndexerBalance[] => {
  if (!address || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${address.toLowerCase()}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const persistBalances = (address: string | null, balances: IndexerBalance[]) => {
  if (!address || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}${address.toLowerCase()}`, JSON.stringify(balances));
  } catch (e) {
    // ignore
  }
};

interface UseIndexerBalancesResult {
  balances: IndexerBalance[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<IndexerBalance[] | void>;
}

export const useIndexerBalances = (address: string | null): UseIndexerBalancesResult => {
  const [balances, setBalances] = useState<IndexerBalance[]>(() => loadCachedBalances(address));
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!address) {
      setBalances([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch from indexer with timeout (more efficient than RPC)
      const fetchPromise = getUserTokenBalances(address);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), 5000)
      );
      const indexerBalances = await Promise.race([fetchPromise, timeoutPromise]) as any[];

      // Transform indexer data to match our balance format
      const processed = indexerBalances
        .map((item: any) => {
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
              } as any;
            }
            
            // Determine token metadata - prioritize registry if known/verified, then indexer metadata, then defaults
            const symbol = nativeMove
              ? "MOVE"
              : (tokenInfo?.symbol ? tokenInfo.symbol : (hasMetadata ? item.metadata.symbol : "Unknown"));
            const name = nativeMove
              ? "Movement"
              : (tokenInfo?.name ? tokenInfo.name : (hasMetadata ? item.metadata.name : symbol));
            const decimals = tokenInfo?.decimals !== undefined
              ? tokenInfo.decimals
              : (hasMetadata && item.metadata.decimals !== undefined ? item.metadata.decimals : 8);
            
            // Token is "known" if it's in our registry
            const isKnown = !!tokenInfo;
            
            const amount = BigInt(item.amount || "0");
            const divisor = BigInt(10) ** BigInt(decimals);
            const quantity = Number(amount) / Number(divisor);

            if (quantity <= 0) {
              return null;
            }

            // Smart formatting for different token types
            const isHighValueToken = ['BTC', 'WBTC', 'ETH', 'WETH'].includes(symbol?.toUpperCase().replace(/\.E$/i, ''));
            
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
              type: assetType,
            };
          } catch {
            return null;
          }
        })
        .filter((i): i is IndexerBalance => i !== null)
        .sort((a, b) => b.numericAmount - a.numericAmount);

      setBalances(processed);
      persistBalances(address, processed);
      return processed;
    } catch (err: any) {
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
