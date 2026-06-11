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
  movePrice: number;
  valuationMethod: 'topBid' | 'floor';
  setValuationMethod: (method: 'topBid' | 'floor') => void;
  totalWorthMove: number;
  totalWorthUSD: number;
}

const NFTTable: React.FC<NFTTableProps> = ({
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
  totalWorthUSD
}) => {
  return (
    <section className="nft-portfolio-section">
      <div className="nft-header">
        <div className="nft-header-title">
          <h3>NFT Portfolio</h3>
          <span className="nft-count-badge">{userNFTs.length} Assets</span>
        </div>

        {userNFTs.length > 0 && (
          <div className="nft-header-controls">
            <div className="nft-total-value">
              <span className="value-label">Total Value</span>
              <span className="value-move">{totalWorthMove.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE</span>
              <span className="value-usd">
                {hideValues ? '***' : formatCurrencyValue(convertUSD(totalWorthUSD))}
              </span>
            </div>

            <div className="nft-valuation-toggle">
              <button
                className={`toggle-btn ${valuationMethod === 'topBid' ? 'active' : ''}`}
                onClick={() => setValuationMethod('topBid')}
                title="Valuation based on top active bids"
              >
                Top Bid
              </button>
              <button
                className={`toggle-btn ${valuationMethod === 'floor' ? 'active' : ''}`}
                onClick={() => setValuationMethod('floor')}
                title="Valuation based on floor price"
              >
                Floor Price
              </button>
            </div>
          </div>
        )}
      </div>

      {nftsLoading ? (
        <div className="nft-skeleton-container">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="nft-skeleton-row" />
          ))}
        </div>
      ) : groupedCollections.length > 0 ? (
        <div className="nft-table-wrapper">
          <table className="nft-minimal-table">
            <thead>
              <tr>
                <th>Collection</th>
                <th className="text-right">Items</th>
                <th className="text-right">Floor Price</th>
                <th className="text-right">Top Bid</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {groupedCollections.map((col) => {
                const tradeportUrl = `https://www.tradeport.xyz/movement/collection/${col.collectionId}`;

                return (
                  <tr key={col.collectionId}>
                    <td className="col-info">
                      <div className="col-images">
                        {col.sampleImages.slice(0, 3).map((img, i) => (
                          <div key={i} className="col-img-wrap" style={{ zIndex: 3 - i }}>
                            <img
                              src={img.startsWith('ipfs://') ? img.replace('ipfs://', 'https://ipfs.io/ipfs/') : img}
                              alt=""
                              onError={(e) => { (e.target as HTMLImageElement).src = '/movement-logo.svg'; }}
                            />
                          </div>
                        ))}
                        {col.count > 3 && (
                          <div className="col-img-more">
                            +{col.count - 3}
                          </div>
                        )}
                      </div>
                      <span className="col-name">{col.collectionName}</span>
                    </td>
                    <td className="text-right col-count">{col.count}</td>
                    <td className="text-right">
                      <div className="col-price">
                        <span className="price-primary">
                          {col.floorPrice > 0 ? (
                            `${col.floorPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE`
                          ) : (
                            <span className="price-empty">--</span>
                          )}
                        </span>
                        {col.floorPrice > 0 && movePrice > 0 && (
                          <span className="price-secondary">
                            {hideValues ? '***' : formatCurrencyValue(convertUSD(col.floorPrice * movePrice))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="price-primary">
                        {col.topBid > 0 ? (
                          `${col.topBid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE`
                        ) : (
                          <span className="price-empty">--</span>
                        )}
                      </span>
                    </td>
                    <td className="text-right">
                      <a
                        href={tradeportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="action-link"
                        title="View on Tradeport"
                      >
                        Tradeport ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="nft-empty">
          <p>{viewingAddress ? "No NFTs found in this wallet." : "Connect your wallet to see your NFTs."}</p>
        </div>
      )}
    </section>
  );
};

export default NFTTable;
