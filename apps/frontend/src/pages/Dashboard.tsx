import React, { Suspense, lazy } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { resolveEffectiveTier } from "../utils/subscription";

import "./Dashboard.css";
import { useDashboardData } from "../hooks/useDashboardData";
import { DashboardHero } from "../components/Dashboard/DashboardHero";
import ProfileModal from "../components/Dashboard/ProfileModal";
import PortfolioTabs, { PORTFOLIO_TABS } from "../components/Dashboard/PortfolioTabs";
import OverviewTab from '../components/Dashboard/OverviewTab';
import TransactionsTab from '../components/Dashboard/TransactionsTab';
import AnalyticsSkeleton from '../components/Analytics/AnalyticsSkeleton';

const AnalyticsView = lazy(() => import('../components/Analytics/AnalyticsView'));

const Dashboard = () => {
  const data = useDashboardData();

  return (
    <>
      <DashboardHero {...data} />

      <PortfolioTabs
        activeTab={data.activeTab}
        urlAddress={data.urlAddress}
        canEditProfile={data.canEditProfile}
        language={data.language}
        subscriptionTier={resolveEffectiveTier(data.userProfile)}
        isVerified={Boolean(data.userProfile?.is_verified)}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={data.activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="portfolio-content-panel"
        >
          {data.activeTab === PORTFOLIO_TABS.OVERVIEW && (
            <OverviewTab
              language={data.language}
              hideValues={data.hideValues}
              viewMode={data.viewMode}
              setViewMode={data.setViewMode}
              allDeFiExpanded={data.allDeFiExpanded}
              setAllDeFiExpanded={data.setAllDeFiExpanded}
              balances={data.balances}
              indexerLoading={data.indexerLoading}
              defiLoading={data.defiLoading}
              assetsLoading={data.assetsLoading}
              lpLoading={data.lpLoading}
              indexerError={data.indexerError}
              error={data.error}
              viewingAddress={data.viewingAddress}
              totalUsdValue={data.totalUsdValue}
              defiNetValue={data.defiNetValue}
              liquidityTotalValue={data.liquidityTotalValue}
              stakingTotalValue={data.stakingTotalValue}
              visibleDeFiPositions={data.visibleDeFiPositions}
              visibleLiquidityPositions={data.visibleLiquidityPositions}
              visibleStakingPositions={data.visibleStakingPositions}
              priceMap={data.priceMap}
              convertUSD={data.convertUSD}
              formatCurrencyValue={data.formatCurrencyValue}
              currencySymbol={data.currencySymbol}
            />
          )}

          {data.activeTab === PORTFOLIO_TABS.TRX && (
            <TransactionsTab
              viewingAddress={data.viewingAddress}
              lastRefresh={data.lastRefresh}
              subscriptionTier={resolveEffectiveTier(data.userProfile)}
              hideValues={data.hideValues}
              language={data.language}
            />
          )}

          {data.activeTab === PORTFOLIO_TABS.ANALYTICS && (
            <Suspense fallback={
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', padding: '40px 20px 40px 20px' }}>
                <AnalyticsSkeleton />
              </div>
            }>
              <AnalyticsView
                walletAddress={data.urlAddress}
              />
            </Suspense>
          )}
        </motion.div>
      </AnimatePresence>

      {data.showProfileModal && (
        <ProfileModal
          viewingAddress={data.viewingAddress}
          canEditProfile={data.canEditProfile}
          language={data.language}
          onClose={() => data.setShowProfileModal(false)}
          preloadedProfile={data.userProfile}
          preloadedAvatarSrc={data.userAvatarSrc}
        />
      )}
    </>
  );
};

export default Dashboard;
