import React, { Suspense, lazy } from 'react';

const TrxHistory = lazy(() => import('../Transactions/TrxHistory'));

const RouteFallback = () => <div className="loading-indicator">Loading...</div>;

interface TransactionsTabProps {
  viewingAddress: string | null;
  lastRefresh: number;
  subscriptionTier?: 'free' | 'lite' | 'pro';
  hideValues: boolean;
  language: string;
}

const TransactionsTab: React.FC<TransactionsTabProps> = ({
  viewingAddress,
  lastRefresh,
  subscriptionTier = 'free',
  hideValues,
  language,
}) => {
  return (
    <section className="grid-section">
      <Suspense fallback={<RouteFallback />}>
        <TrxHistory
          walletAddress={viewingAddress}
          refreshTrigger={lastRefresh}
          subscriptionTier={subscriptionTier}
          hideValues={hideValues}
          language={language}
        />
      </Suspense>
    </section>
  );
};

export default TransactionsTab;
