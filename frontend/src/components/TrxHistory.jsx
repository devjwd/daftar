import React, { useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_TOKEN_COLOR, TOKEN_VISUALS } from '../config/display.js';

import styles from './TrxHistory.module.css';

const FILTERS = [
  { label: 'ALL', value: 'all' },
  { label: 'SWAPS', value: 'swap' },
  { label: 'DEPOSITS', value: 'deposit' },
  { label: 'WITHDRAWALS', value: 'withdraw' },
];

const EXPLORER_TX_BASE = 'https://explorer.movementlabs.xyz/txn';

const EMPTY_RESPONSE = {
  transactions: [],
  total: 0,
  page: 1,
  hasMore: false,
};

const TYPE_LABELS = {
  swap: 'SWAP',
  deposit: 'DEPOSIT',
  withdraw: 'WITHDRAW',
  transfer: 'TRANSFER',
  other: 'OTHER',
};

const cn = (...parts) => parts.filter(Boolean).join(' ');

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
    maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
  }).format(amount);
};

const formatAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: amount !== 0 && Math.abs(amount) < 1 ? 2 : 0,
    maximumFractionDigits: 4,
  }).format(amount);
};

const formatSignedCurrency = (value) => {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${formatCurrency(amount)}`;
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${datePart} · ${timePart}`;
};

const truncateHash = (value) => {
  const hash = String(value || '');
  if (hash.length <= 14) {
    return hash || '—';
  }

  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

const getTokenVisual = (symbol) => {
  const normalized = String(symbol || '').toUpperCase().replace(/\.E$/i, '').trim();
  const alias = {
    ETH: 'WETH',
    BTC: 'WBTC',
  };
  const key = alias[normalized] || normalized;
  return TOKEN_VISUALS[key] || TOKEN_VISUALS[normalized] || null;
};

const getBadgeClass = (type) => {
  const normalized = String(type || 'other').toLowerCase();
  if (normalized === 'swap') return styles.badgeSwap;
  if (normalized === 'deposit') return styles.badgeDeposit;
  if (normalized === 'withdraw') return styles.badgeWithdraw;
  if (normalized === 'transfer') return styles.badgeTransfer;
  return styles.badgeOther;
};

const TokenIcon = ({ symbol }) => {
  const visual = getTokenVisual(symbol);
  const normalized = String(symbol || '').toUpperCase();
  const color = visual?.color || DEFAULT_TOKEN_COLOR;

  return (
    <span
      className={styles.tokenIcon}
      style={{
        '--token-primary': color.primary,
        '--token-secondary': color.secondary,
      }}
      aria-hidden="true"
    >
      {visual?.logo ? <img src={visual.logo} alt="" className={styles.tokenIconImage} /> : normalized.charAt(0) || '?'}
    </span>
  );
};

const SkeletonRows = () => (
  <div className={styles.skeletonList} aria-hidden="true">
    {Array.from({ length: 5 }).map((_, index) => (
      <div key={index} className={styles.skeletonRow}>
        <span className={cn(styles.skeletonBlock, styles.skeletonBadge)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonTokens)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonAmount)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonUsd)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonPnl)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonDate)} />
        <span className={cn(styles.skeletonBlock, styles.skeletonHash)} />
      </div>
    ))}
  </div>
);

export default function TrxHistory({ walletAddress }) {
  const mountedRef = useRef(true);
  const paginationAbortRef = useRef(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      paginationAbortRef.current?.abort();
      paginationAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setTransactions([]);
      setPage(1);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setError('');
      setLoadMoreError('');
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;

    const fetchTransactions = async () => {
      setLoading(true);
      setLoadingMore(false);
      setError('');
      setLoadMoreError('');

      try {
        const params = new URLSearchParams({
          wallet: walletAddress,
          page: '1',
          type: activeFilter,
        });
        const response = await fetch(`/api/transactions?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Transactions request failed (${response.status})`);
        }

        const json = await response.json();
        if (!disposed) {
          const payload = { ...EMPTY_RESPONSE, ...json };
          setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
          setPage(Number(payload.page || 1));
          setTotal(Number(payload.total || 0));
          setHasMore(Boolean(payload.hasMore));
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') {
          return;
        }

        console.error('Failed to fetch transactions:', fetchError);
        if (!disposed) {
          setError('Unable to load transactions right now');
          setTransactions([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setLoadMoreError('');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void fetchTransactions();

    return () => {
      disposed = true;
      controller.abort();
      paginationAbortRef.current?.abort();
      paginationAbortRef.current = null;
    };
  }, [activeFilter, walletAddress]);

  const handleLoadMore = async () => {
    if (!walletAddress || loadingMore || !hasMore || !mountedRef.current) {
      return;
    }

    paginationAbortRef.current?.abort();
    const controller = new AbortController();
    paginationAbortRef.current = controller;

    if (!mountedRef.current) return;
    setLoadingMore(true);
    setLoadMoreError('');

    try {
      const nextPage = page + 1;
      const params = new URLSearchParams({
        wallet: walletAddress,
        page: String(nextPage),
        type: activeFilter,
      });
      const response = await fetch(`/api/transactions?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Transactions request failed (${response.status})`);
      }

      const json = await response.json();
      const payload = { ...EMPTY_RESPONSE, ...json };
      if (!mountedRef.current) return;
      setTransactions((prev) => [...prev, ...(Array.isArray(payload.transactions) ? payload.transactions : [])]);
      if (!mountedRef.current) return;
      setPage(Number(payload.page || nextPage));
      if (!mountedRef.current) return;
      setTotal(Number(payload.total || 0));
      if (!mountedRef.current) return;
      setHasMore(Boolean(payload.hasMore));
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') {
        return;
      }

      console.error('Failed to load more transactions:', fetchError);
      if (!mountedRef.current) return;
      setLoadMoreError('Unable to load more transactions');
    } finally {
      if (paginationAbortRef.current === controller) {
        paginationAbortRef.current = null;
      }
      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const txCountLabel = useMemo(() => {
    const totalTransactions = Math.max(Number(total || 0), transactions.length);
    return `${totalTransactions} ${totalTransactions === 1 ? 'transaction' : 'transactions'}`;
  }, [total, transactions.length]);

  if (!walletAddress) {
    return <section className={styles.emptyState}>Connect wallet to view transactions</section>;
  }

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div className={styles.filterTabs}>
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={cn(styles.filterTab, activeFilter === filter.value && styles.filterTabActive)}
              onClick={() => setActiveFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className={styles.toolbarMeta}>{txCountLabel}</div>
      </div>

      {loading ? <SkeletonRows /> : null}

      {!loading && error ? <div className={styles.emptyState}>{error}</div> : null}

      {!loading && !error && transactions.length === 0 ? (
        <div className={styles.emptyState}>No transactions found</div>
      ) : null}

      {!loading && !error && transactions.length > 0 ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Tokens</th>
                  <th>Amount</th>
                  <th className={styles.columnUsd}>USD Value</th>
                  <th className={styles.columnPnl}>PNL</th>
                  <th>Date</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const txUrl = `${EXPLORER_TX_BASE}/${encodeURIComponent(tx.tx_hash)}?network=mainnet`;
                  const tokenIn = String(tx.token_in || '—').toUpperCase();
                  const tokenOut = String(tx.token_out || '—').toUpperCase();
                  const isSwap = String(tx.tx_type || '').toLowerCase() === 'swap';

                  return (
                    <tr
                      key={tx.tx_hash}
                      className={styles.row}
                      onClick={() => window.open(txUrl, '_blank', 'noopener,noreferrer')}
                    >
                      <td>
                        <span className={cn(styles.typeBadge, getBadgeClass(tx.tx_type))}>
                          {TYPE_LABELS[String(tx.tx_type || 'other').toLowerCase()] || 'OTHER'}
                        </span>
                      </td>
                      <td>
                        <div className={styles.tokenPair}>
                          <div className={styles.tokenSide}>
                            <TokenIcon symbol={tx.token_in} />
                            <span>{tokenIn}</span>
                          </div>
                          <span className={styles.tokenArrow}>→</span>
                          <div className={styles.tokenSide}>
                            <TokenIcon symbol={tx.token_out} />
                            <span>{tokenOut}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.amountPair}>
                          <span>{formatAmount(tx.amount_in)}</span>
                          <span className={styles.amountArrow}>→</span>
                          <span>{formatAmount(tx.amount_out)}</span>
                        </div>
                      </td>
                      <td className={styles.columnUsd}>{formatCurrency(tx.amount_in_usd || 0)}</td>
                      <td className={cn(styles.columnPnl, isSwap ? (Number(tx.pnl_usd || 0) >= 0 ? styles.positive : styles.negative) : styles.neutral)}>
                        {isSwap ? formatSignedCurrency(tx.pnl_usd || 0) : '—'}
                      </td>
                      <td>{formatDateTime(tx.tx_timestamp)}</td>
                      <td>
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.hashLink}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {truncateHash(tx.tx_hash)}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <div className={styles.loadMoreWrap}>
              <button
                type="button"
                className={styles.loadMoreButton}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          ) : null}

          {loadMoreError ? <div className={styles.inlineError}>{loadMoreError}</div> : null}
        </>
      ) : null}
    </section>
  );
}