import React, { useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_TOKEN_COLOR, TOKEN_VISUALS } from '../config/display.js';
import { checkAccountExists } from '../services/indexer.js';

import styles from './TrxHistory.module.css';

const FILTERS = [
  { label: 'ALL', value: 'all' },
  { label: 'SWAPS', value: 'swap' },
  { label: 'LENDING', value: 'lending' },
  { label: 'STAKING', value: 'staking' },
  { label: 'TRANSFERS', value: 'transfers' },
];

const EXPLORER_TX_BASE = 'https://explorer.movementlabs.xyz/txn';
const TRANSACTIONS_PAGE_SIZE = 20;

const EMPTY_RESPONSE = {
  transactions: [],
  total: 0,
  page: 1,
  hasMore: false,
};

const TYPE_LABELS = {
  swap: 'SWAP',
  lend: 'LEND',
  borrow: 'BORROW',
  repay: 'REPAY',
  stake: 'STAKE',
  unstake: 'UNSTAKE',
  deposit: 'DEPOSIT',
  withdraw: 'WITHDRAW',
  transfer: 'TRANSFER',
  received: 'RECEIVED',
  claim: 'CLAIM',
  other: 'OTHER',
};

const cn = (...parts) => parts.filter(Boolean).join(' ');

const parseTimestampDate = (value) => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value}Z`
      : value;
    return new Date(normalized);
  }

  return new Date(value);
};

const fetchTransactionsPage = async ({ walletAddress, activeFilter, page, signal }) => {
  const params = new URLSearchParams({
    wallet: walletAddress,
    page: String(page),
    type: activeFilter,
  });

  try {
    const response = await fetch(`/api/transactions?${params.toString()}`, {
      signal,
    });

    if (!response.ok) {
      throw new Error(`Transactions request failed (${response.status})`);
    }

    const json = await response.json();
    return { ...EMPTY_RESPONSE, ...json };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    throw error;
  }
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

const hasPositiveDisplayNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const getAmountTone = (tx) => {
  const hasAmountIn = hasPositiveDisplayNumber(tx?.amount_in);
  const hasAmountOut = hasPositiveDisplayNumber(tx?.amount_out);

  if (hasAmountIn && !hasAmountOut) {
    return 'negative';
  }

  if (hasAmountOut && !hasAmountIn) {
    return 'positive';
  }

  return 'neutral';
};

const getDisplayAmounts = (tx) => {
  const txType = String(tx?.tx_type || 'other').toLowerCase();
  const amountIn = tx?.amount_in;
  const amountOut = tx?.amount_out;
  const hasAmountIn = hasPositiveDisplayNumber(amountIn);
  const hasAmountOut = hasPositiveDisplayNumber(amountOut);

  if (['lend', 'deposit', 'repay'].includes(txType)) {
    return hasAmountIn ? [amountIn] : hasAmountOut ? [amountOut] : [];
  }

  if (txType === 'stake') {
    if (hasAmountIn && hasAmountOut) {
      return [amountIn, amountOut];
    }

    return hasAmountIn ? [amountIn] : hasAmountOut ? [amountOut] : [];
  }

  if (['withdraw', 'unstake', 'claim', 'borrow', 'received'].includes(txType)) {
    return hasAmountOut ? [amountOut] : hasAmountIn ? [amountIn] : [];
  }

  if (txType === 'swap') {
    const output = [];
    if (hasAmountIn) output.push(amountIn);
    if (hasAmountOut) output.push(amountOut);
    return output;
  }

  const output = [];
  if (hasAmountIn) output.push(amountIn);
  if (hasAmountOut) output.push(amountOut);
  return output;
};

const shortenTokenLabel = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (/^0x[a-f0-9]{12,}$/i.test(normalized)) {
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`.toUpperCase();
  }

  if (normalized.length > 18) {
    return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`.toUpperCase();
  }

  return normalized.toUpperCase();
};

const normalizeDisplayToken = (value) => {
  const normalized = String(value || '').trim();
  return normalized
    ? {
        label: shortenTokenLabel(normalized),
        full: normalized.toUpperCase(),
      }
    : null;
};

const formatDateTime = (value) => {
  const date = parseTimestampDate(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.floor(diffMs / (60 * 1000));

    if (totalMinutes <= 0) {
      return 'just now';
    }

    if (totalMinutes < 60) {
      return `${totalMinutes} min ago`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (minutes === 0) {
      return `${hours} hr ago`;
    }

    return `${hours} hr ${minutes} min ago`;
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
  if (normalized === 'lend') return styles.badgeLend;
  if (normalized === 'borrow') return styles.badgeBorrow;
  if (normalized === 'repay') return styles.badgeRepay;
  if (normalized === 'stake') return styles.badgeStake;
  if (normalized === 'unstake') return styles.badgeUnstake;
  if (normalized === 'deposit') return styles.badgeDeposit;
  if (normalized === 'withdraw') return styles.badgeWithdraw;
  if (normalized === 'transfer') return styles.badgeTransfer;
  if (normalized === 'received') return styles.badgeReceived;
  if (normalized === 'claim') return styles.badgeClaim;
  return styles.badgeOther;
};

const DappIcon = ({ tx }) => {
  const dappName = String(tx?.dapp_name || 'Wallet');
  const dappLogo = String(tx?.dapp_logo || '').trim();

  return (
    <span className={styles.dappIcon} aria-hidden="true">
      {dappLogo ? <img src={dappLogo} alt="" className={styles.dappIconImage} /> : dappName.charAt(0) || '?'}
    </span>
  );
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
  const [totalTransactionCount, setTotalTransactionCount] = useState(null);
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
      setTotalTransactionCount(null);
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
        const json = await fetchTransactionsPage({
          walletAddress,
          activeFilter,
          page: 1,
          signal: controller.signal,
        });

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

  useEffect(() => {
    if (!walletAddress) {
      setTotalTransactionCount(null);
      return undefined;
    }

    let disposed = false;

    const fetchTotalTransactionCount = async () => {
      try {
        const result = await checkAccountExists(walletAddress);
        if (!disposed) {
          const nextCount = Number(result?.txCount);
          setTotalTransactionCount(Number.isFinite(nextCount) ? nextCount : 0);
        }
      } catch (countError) {
        console.error('Failed to fetch total transaction count:', countError);
        if (!disposed) {
          setTotalTransactionCount(null);
        }
      }
    };

    void fetchTotalTransactionCount();

    return () => {
      disposed = true;
    };
  }, [walletAddress]);

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
      const json = await fetchTransactionsPage({
        walletAddress,
        activeFilter,
        page: nextPage,
        signal: controller.signal,
      });

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
    if (Number.isFinite(totalTransactionCount)) {
      return `${totalTransactionCount} ${totalTransactionCount === 1 ? 'total transaction' : 'total transactions'}`;
    }

    const totalTransactions = Math.max(Number(total || 0), transactions.length);
    return `${totalTransactions} ${totalTransactions === 1 ? 'transaction' : 'transactions'}`;
  }, [total, totalTransactionCount, transactions.length]);

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
                  <th>Date</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const txUrl = `${EXPLORER_TX_BASE}/${encodeURIComponent(tx.tx_hash)}?network=mainnet`;
                  const tokenIn = normalizeDisplayToken(tx.token_in);
                  const tokenOut = normalizeDisplayToken(tx.token_out);
                  const hasTokenIn = Boolean(tokenIn?.label);
                  const hasTokenOut = Boolean(tokenOut?.label);
                  const displayAmounts = getDisplayAmounts(tx);
                  const hasAmountIn = displayAmounts.length > 0;
                  const hasAmountOut = displayAmounts.length > 1;
                  const amountTone = getAmountTone(tx);
                  const dappName = String(tx.dapp_name || 'Wallet');
                  const typeLabel = TYPE_LABELS[String(tx.tx_type || 'other').toLowerCase()] || 'OTHER';
                  const typeTitle = tx.dapp_contract
                    ? `${dappName} · ${typeLabel} · ${tx.dapp_contract}`
                    : `${dappName} · ${typeLabel}`;

                  return (
                    <tr
                      key={tx.tx_hash}
                      className={styles.row}
                    >
                      <td>
                        <div className={styles.typeCell} title={typeTitle}>
                          <DappIcon tx={tx} />
                          <div className={styles.typeMeta}>
                            <span className={cn(styles.typeBadge, getBadgeClass(tx.tx_type))}>
                              {typeLabel}
                            </span>
                            <span className={styles.typeDappName}>{dappName}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.tokenPair}>
                          {hasTokenIn ? (
                            <div className={styles.tokenSide} title={tokenIn.full}>
                              <TokenIcon symbol={tokenIn.full} />
                              <span>{tokenIn.label}</span>
                            </div>
                          ) : null}
                          {hasTokenIn && hasTokenOut ? <span className={styles.tokenArrow}>→</span> : null}
                          {hasTokenOut ? (
                            <div className={styles.tokenSide} title={tokenOut.full}>
                              <TokenIcon symbol={tokenOut.full} />
                              <span>{tokenOut.label}</span>
                            </div>
                          ) : null}
                          {!hasTokenIn && !hasTokenOut ? <span className={styles.neutral}>—</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className={styles.amountPair}>
                          {hasAmountIn ? <span className={styles[amountTone]}>{formatAmount(displayAmounts[0])}</span> : null}
                          {hasAmountIn && hasAmountOut ? <span className={styles.amountArrow}>→</span> : null}
                          {hasAmountOut ? <span className={styles[amountTone]}>{formatAmount(displayAmounts[1])}</span> : null}
                          {!hasAmountIn && !hasAmountOut ? <span className={styles.neutral}>—</span> : null}
                        </div>
                      </td>
                      <td>{formatDateTime(tx.tx_timestamp)}</td>
                      <td>
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.hashLink}
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