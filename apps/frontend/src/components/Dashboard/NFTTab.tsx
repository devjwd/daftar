import React, { Suspense, lazy } from 'react';

const NFTTable = lazy(() => import('../NFTs/NFTTable'));

const RouteFallback = () => <div className="loading-indicator">Loading...</div>;

interface NFTTabProps {
  userNFTs: any[];
  groupedCollections: any;
  nftsLoading: boolean;
  viewingAddress: string | null;
}

const NFTTab: React.FC<NFTTabProps> = ({
  userNFTs,
  groupedCollections,
  nftsLoading,
  viewingAddress
}) => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <NFTTable
        userNFTs={userNFTs}
        groupedCollections={groupedCollections}
        nftsLoading={nftsLoading}
        viewingAddress={viewingAddress}
      />
    </Suspense>
  );
};

export default NFTTab;
