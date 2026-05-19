import React, { Suspense, lazy } from 'react';

const NFTTable = lazy(() => import('../NFTs/NFTTable'));

const RouteFallback = () => <div className="loading-indicator">Loading...</div>;

interface NFTTabProps {
  userNFTs: any[];
  groupedCollections: any;
  nftsLoading: boolean;
  viewingAddress: string | null;
  hideValues: boolean;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number) => string;
  movePrice: number;
  valuationMethod: 'topBid' | 'floor';
  setValuationMethod: (method: 'topBid' | 'floor') => void;
  totalWorthMove: number;
  totalWorthUSD: number;
}

const NFTTab: React.FC<NFTTabProps> = ({
  userNFTs,
  groupedCollections,
  nftsLoading,
  viewingAddress,
  hideValues,
  convertUSD,
  formatCurrencyValue,
  movePrice,
  valuationMethod,
  setValuationMethod,
  totalWorthMove,
  totalWorthUSD,
}) => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <NFTTable
        userNFTs={userNFTs}
        groupedCollections={groupedCollections}
        nftsLoading={nftsLoading}
        viewingAddress={viewingAddress}
        hideValues={hideValues}
        convertUSD={convertUSD}
        formatCurrencyValue={formatCurrencyValue}
        movePrice={movePrice}
        valuationMethod={valuationMethod}
        setValuationMethod={setValuationMethod}
        totalWorthMove={totalWorthMove}
        totalWorthUSD={totalWorthUSD}
      />
    </Suspense>
  );
};

export default NFTTab;
