import React, { useState, useMemo } from 'react';
import { t } from '../../utils/language';
import { useTransactions, AdvancedFilters } from '../../hooks/useTransactions';

import styles from './TrxHistory.module.css';
import AdvancedFilterModal from './AdvancedFilterModal';
import TransactionVisualizer from './TransactionVisualizer';
import TransactionTableRow from './TransactionTableRow';



const cn = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(' ');

const SkeletonRows = ({ count = 5 }: { count?: number }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={index} className={styles.skeletonRow}>
        <td>
          <div className={styles.skeletonTypeCell}>
            <div className={cn(styles.skeletonBlock, styles.skeletonIcon)} />
            <div className={styles.skeletonTypeMeta}>
              <div className={cn(styles.skeletonBlock, styles.skeletonBadge)} />
              <div className={cn(styles.skeletonBlock, styles.skeletonDappName)} />
            </div>
          </div>
        </td>
        <td>
          <div className={cn(styles.skeletonBlock, styles.skeletonTokens)} />
        </td>
        <td>
          <div className={cn(styles.skeletonBlock, styles.skeletonAmount)} />
        </td>
        <td>
          <div className={cn(styles.skeletonBlock, styles.skeletonDate)} />
        </td>
        <td>
          <div className={cn(styles.skeletonBlock, styles.skeletonHash)} />
        </td>
      </tr>
    ))}
  </>
);

interface TrxHistoryProps {
  walletAddress?: string;
  refreshTrigger?: number;
  subscriptionTier?: 'free' | 'lite' | 'pro';
  hideValues?: boolean;
  language?: string;
}

export default function TrxHistory({
  walletAddress,
  refreshTrigger = 0,
  subscriptionTier = 'free',
  hideValues = false,
  language = 'en',
}: TrxHistoryProps) {
  const isPremium = subscriptionTier !== 'free';

  const [activeFilter, setActiveFilter] = useState('all');
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({
    protocols: [],
    exactTypes: [],
    minAmount: '',
    maxAmount: '',
    startDate: '',
    endDate: '',
  });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedTxForPlayback, setSelectedTxForPlayback] = useState<any | null>(null);

  const {
    transactions,
    hasMore,
    totalCount,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore,
  } = useTransactions(walletAddress, activeFilter, advancedFilters, isPremium, refreshTrigger);

  const handleReportClick = (e: React.MouseEvent, tx: any) => {
    e.preventDefault();
    e.stopPropagation();

    const cleanHash = String(tx.tx_hash || '').replace(/^v/i, '');
    const rawType = String(tx.tx_type || 'other').toUpperCase();
    const dappName = String(tx.dapp_name || 'Wallet');

    const descTemplate = `[Transaction Hash: ${cleanHash}]\n[Transaction Type: ${rawType}]\n[Platform: ${dappName}]\n\nPlease describe what data is incorrect: `;

    const event = new CustomEvent('open-bug-report', {
      detail: {
        type: 'transaction',
        symbol: dappName,
        address: cleanHash,
        description: descTemplate,
      },
    });
    window.dispatchEvent(event);
  };

  const txCountLabel = useMemo(() => {
    if (Number.isFinite(totalCount)) {
      return `${totalCount} ${totalCount === 1 ? 'total transaction' : 'total transactions'}`;
    }

    const totalTransactions = transactions.length;
    return `${totalTransactions} ${totalTransactions === 1 ? 'transaction' : 'transactions'}`;
  }, [totalCount, transactions.length]);

  if (!walletAddress) {
    return <section className={styles.emptyState}>{t(language, 'trxConnectWallet')}</section>;
  }

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div className={styles.filterTabs}>

          <button
            type="button"
            disabled={!isPremium}
            title={!isPremium ? 'Advanced filtering is available for Pro users' : undefined}
            className={cn(
              styles.filterTab,
              (advancedFilters.protocols.length > 0 ||
                advancedFilters.exactTypes.length > 0 ||
                advancedFilters.minAmount ||
                advancedFilters.maxAmount ||
                advancedFilters.startDate ||
                advancedFilters.endDate) &&
                styles.filterTabActive
            )}
            onClick={() => setIsFilterModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            {t(language, 'trxAdvancedFilter')}
          </button>
        </div>
        <div className={styles.toolbarMeta}>{txCountLabel}</div>
      </div>

      <AdvancedFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        initialFilters={advancedFilters}
        onApply={(newFilters: AdvancedFilters) => setAdvancedFilters(newFilters)}
        language={language}
      />

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
            {loading ? (
              <SkeletonRows count={8} />
            ) : error ? (
              <tr>
                <td colSpan={5}>
                  <div className={styles.emptyState}>{error}</div>
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className={styles.emptyState}>{t(language, 'trxNoTransactions')}</div>
                </td>
              </tr>
            ) : (
              <>
                {transactions.map((tx) => (
                  <TransactionTableRow
                    key={tx.tx_hash}
                    tx={tx}
                    hideValues={hideValues}
                    onPlay={setSelectedTxForPlayback}
                    onReport={handleReportClick}
                  />
                ))}
                {loadingMore && <SkeletonRows count={5} />}
              </>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && !loading && !error && transactions.length > 0 ? (
        <div className={styles.loadMoreWrap}>
          <button type="button" className={styles.loadMoreButton} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t(language, 'trxLoadingMore') : t(language, 'trxLoadMore')}
          </button>
        </div>
      ) : null}

      {loadMoreError ? <div className={styles.inlineError}>{loadMoreError}</div> : null}

      {selectedTxForPlayback && (
        <TransactionVisualizer
          tx={selectedTxForPlayback}
          onClose={() => setSelectedTxForPlayback(null)}
          language={language}
        />
      )}
    </section>
  );
}
