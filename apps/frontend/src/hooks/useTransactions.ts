import { useState, useEffect, useRef, useCallback } from 'react';
import { checkAccountExists } from '../services/indexer';
import { getOrFetchTransactions } from '../services/transactionService';

const TRANSACTIONS_PAGE_SIZE = 20;

const EMPTY_RESPONSE = {
  transactions: [],
  total: 0,
  page: 1,
  hasMore: false,
};

export interface AdvancedFilters {
  protocols: string[];
  exactTypes: string[];
  minAmount: string;
  maxAmount: string;
  startDate: string;
  endDate: string;
}

export function useTransactions(
  walletAddress: string | undefined,
  activeFilter: string,
  advancedFilters: AdvancedFilters,
  isPremium: boolean,
  refreshTrigger: number
) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');

  // Internal cache to replace global map
  const cacheRef = useRef(new Map<string, any[]>());
  const paginationAbortRef = useRef<AbortController | null>(null);

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  const fetchTransactionsPage = async (
    targetPage: number,
    signal: AbortSignal
  ) => {
    if (!walletAddress) throw new Error('No wallet address');

    const params = new URLSearchParams({
      wallet: walletAddress,
      page: String(targetPage),
      type: activeFilter,
      limit: String(TRANSACTIONS_PAGE_SIZE)
    });

    if (advancedFilters) {
      if (advancedFilters.protocols?.length) params.append('protocols', advancedFilters.protocols.join(','));
      if (advancedFilters.exactTypes?.length) params.append('exactTypes', advancedFilters.exactTypes.join(','));
      if (advancedFilters.minAmount) params.append('minAmount', advancedFilters.minAmount);
      if (advancedFilters.maxAmount) params.append('maxAmount', advancedFilters.maxAmount);
      if (advancedFilters.startDate) params.append('startDate', advancedFilters.startDate);
      if (advancedFilters.endDate) params.append('endDate', advancedFilters.endDate);
    }

    const filterIndexerRows = (rows: any[]) => {
      if (activeFilter === 'all') return rows;
      if (activeFilter === 'transfers') {
        return rows.filter((tx) => ['transfer', 'received', 'send'].includes(String(tx.tx_type).toLowerCase()));
      }
      if (activeFilter === 'lending') {
        return rows.filter((tx) =>
          ['lend', 'borrow', 'repay', 'deposit', 'withdraw', 'liquidity'].includes(String(tx.tx_type).toLowerCase())
        );
      }
      if (activeFilter === 'staking') {
        return rows.filter((tx) => ['stake', 'unstake', 'claim'].includes(String(tx.tx_type).toLowerCase()));
      }
      return rows.filter((tx) => String(tx.tx_type).toLowerCase() === activeFilter);
    };

    try {
      const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
      const response = await fetch(`${baseUrl}/api/transactions?${params.toString()}`, {
        signal,
      });

      if (response.ok) {
        const json = await response.json();
        
        const hasAdvancedFilters = advancedFilters && (
          advancedFilters.protocols?.length > 0 ||
          advancedFilters.exactTypes?.length > 0 ||
          Boolean(advancedFilters.minAmount) ||
          Boolean(advancedFilters.maxAmount) ||
          Boolean(advancedFilters.startDate) ||
          Boolean(advancedFilters.endDate)
        );

        // If the DB has exactly 0 total transactions (for this query)
        // or if the user is a PRO user, bypass the database to ensure real-time data.
        // Fall back to indexer so the user isn't stuck with an empty or outdated screen.
        const shouldBypassDb = (json.total === 0 || isPremium) && !hasAdvancedFilters;
        if (shouldBypassDb) {
          throw new Error('Bypassing database for real-time indexer data');
        }

        return {
          ...EMPTY_RESPONSE,
          ...json,
          source: 'database',
        };
      }
    } catch (backendError: any) {
      if (backendError?.name === 'AbortError') {
        throw backendError;
      }
      console.warn('[useTransactions] Backend fetch failed, falling back to indexer:', backendError.message);
    }

    try {
      const cacheKey = `${walletAddress}:${activeFilter}:${JSON.stringify(advancedFilters)}`;
      const cache = cacheRef.current.get(cacheKey) || [];

      const from = (targetPage - 1) * TRANSACTIONS_PAGE_SIZE;
      const to = from + TRANSACTIONS_PAGE_SIZE;
      const neededCount = to + 1;

      if (cache.length < neededCount) {
        const fetchLimit = Math.max(neededCount + TRANSACTIONS_PAGE_SIZE, targetPage * TRANSACTIONS_PAGE_SIZE + TRANSACTIONS_PAGE_SIZE);
        const indexerRows = await getOrFetchTransactions(walletAddress, {
          limit: fetchLimit,
          allowCachedRead: false,
          persist: false,
        });
        const newCache = filterIndexerRows(indexerRows);
        cacheRef.current.set(cacheKey, newCache);
      }

      const filteredRows = cacheRef.current.get(cacheKey) || [];
      const pageRows = filteredRows.slice(from, to);

      return {
        transactions: pageRows,
        total: filteredRows.length,
        page: targetPage,
        hasMore: filteredRows.length > to,
        source: 'indexer-fallback',
      };
    } catch (indexerError) {
      console.error('[useTransactions] Indexer fallback also failed:', indexerError);
      throw indexerError;
    }
  };

  useEffect(() => {
    if (!walletAddress) {
      setTransactions([]);
      setPage(1);
      setHasMore(false);
      setLoading(false);
      setError('');
      return;
    }

    cacheRef.current.clear();
    const controller = new AbortController();
    let disposed = false;

    const initFetch = async () => {
      setLoading(true);
      setError('');

      try {
        const json = await fetchTransactionsPage(1, controller.signal);
        if (!disposed) {
          setTransactions(Array.isArray(json.transactions) ? json.transactions : []);
          setPage(1);
          setHasMore(Boolean(json.hasMore));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (!disposed) {
          setError('Unable to load transactions right now');
          setTransactions([]);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void initFetch();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [walletAddress, activeFilter, advancedFilters, isPremium, refreshTrigger, clearCache]);

  useEffect(() => {
    if (!walletAddress) {
      setTotalCount(null);
      return;
    }
    let disposed = false;
    const fetchTotal = async () => {
      try {
        const result = await checkAccountExists(walletAddress);
        if (!disposed) {
          const nextCount = Number(result?.txCount);
          setTotalCount(Number.isFinite(nextCount) ? nextCount : 0);
        }
      } catch {
        if (!disposed) setTotalCount(null);
      }
    };
    void fetchTotal();
    return () => { disposed = true; };
  }, [walletAddress]);

  const loadMore = async () => {
    if (!walletAddress || loadingMore || !hasMore) return;

    paginationAbortRef.current?.abort();
    const controller = new AbortController();
    paginationAbortRef.current = controller;

    setLoadingMore(true);
    setLoadMoreError('');

    try {
      const nextPage = page + 1;
      const json = await fetchTransactionsPage(nextPage, controller.signal);
      
      setTransactions((prev) => [...prev, ...(Array.isArray(json.transactions) ? json.transactions : [])]);
      setPage(nextPage);
      setHasMore(Boolean(json.hasMore));
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setLoadMoreError('Unable to load more transactions');
    } finally {
      if (paginationAbortRef.current === controller) paginationAbortRef.current = null;
      setLoadingMore(false);
    }
  };

  return {
    transactions,
    page,
    hasMore,
    totalCount,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore
  };
}
