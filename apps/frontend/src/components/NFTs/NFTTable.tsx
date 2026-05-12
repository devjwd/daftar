import React from 'react';
import './NFTTable.css';

interface NFTTableProps {
  userNFTs: any[];
  groupedCollections: any[];
  nftsLoading: boolean;
  viewingAddress: string | null;
  hideValues: boolean;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number) => string;
}

const NFTTable: React.FC<NFTTableProps> = ({
  userNFTs,
  groupedCollections,
  nftsLoading,
  viewingAddress,
  hideValues,
  convertUSD,
  formatCurrencyValue
}) => {
  return (
    <section className="grid-section">
      <div className="section-header-row">
        <div className="section-title-group">
          <h3 className="section-title">NFT Portfolio</h3>
          <div className="section-header-value">
            {userNFTs.length} Assets
          </div>
        </div>
      </div>

      {nftsLoading ? (
        <div className="nft-skeleton-table">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="nft-skeleton-row" />
          ))}
        </div>
      ) : groupedCollections.length > 0 ? (
        <div className="nft-table-container">
          <table className="nft-table">
            <thead>
              <tr>
                <th>Collection Name</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Floor Price</th>
                <th className="text-right">Top Bid</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {groupedCollections.map((col) => {
                const tradeportUrl = `https://www.tradeport.xyz/movement/collection/${col.collectionId}`;
                
                return (
                  <tr key={col.collectionId}>
                    <td className="collection-cell">
                      <div className="collection-info">
                        <span className="collection-name-text">
                          {col.collectionName}
                        </span>
                        <div className="collection-images-stack">
                          {col.sampleImages.slice(0, 3).map((img, i) => (
                            <div key={i} className="collection-img-wrapper" style={{ marginLeft: i > 0 ? '-24px' : '0', zIndex: 3 - i }}>
                              <img
                                src={img.startsWith('ipfs://') ? img.replace('ipfs://', 'https://ipfs.io/ipfs/') : img}
                                alt=""
                                onError={(e) => { (e.target as HTMLImageElement).src = '/movement-logo.svg'; }}
                              />
                            </div>
                          ))}
                          {col.count > 3 && (
                            <div className="collection-img-more">
                              +{col.count - 3}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-right">{col.count}</td>
                    <td className="text-right">
                      <div className="price-stack">
                        <span className="native-price">{col.floorPrice > 0 ? `${col.floorPrice.toFixed(2)} MOVE` : '-'}</span>
                        {col.totalUsdValue > 0 && (
                          <span className="usd-price">
                            {hideValues ? '***' : formatCurrencyValue(convertUSD(col.totalUsdValue))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="native-price">{col.topBid > 0 ? `${col.topBid.toFixed(2)} MOVE` : '-'}</span>
                    </td>
                    <td className="text-center">
                      <a
                        href={tradeportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="list-btn"
                      >
                        View on Tradeport
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="nft-empty-state">
          <div className="empty-icon">🖼️</div>
          <p>{viewingAddress ? "No NFTs found in this wallet" : "Connect your wallet to see your NFTs"}</p>
        </div>
      )}
    </section>
  );
};

export default NFTTable;
