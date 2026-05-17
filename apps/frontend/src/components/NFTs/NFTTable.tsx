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
    <section className="grid-section">
      <div className="section-header-row">
        <div className="section-title-group">
          <h3 className="section-title">NFT Portfolio</h3>
          <div className="section-header-value">
            {userNFTs.length} Assets
          </div>
        </div>

        <div className="valuation-controls-wrapper">
          <div className="valuation-controls-row">
            {userNFTs.length > 0 && (
              <div className="valuation-summary">
                <span className="summary-label">Total Value:</span>
                <span className="summary-value-move">{totalWorthMove.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE</span>
                <span className="summary-value-usd">
                  ({hideValues ? '***' : formatCurrencyValue(convertUSD(totalWorthUSD))})
                </span>
              </div>
            )}

            <div className="valuation-toggle-container">
              <button 
                className={`valuation-toggle-btn ${valuationMethod === 'topBid' ? 'active' : ''}`}
                onClick={() => setValuationMethod('topBid')}
                title="Valuation based on top active bids (instant sell / exit value)"
              >
                Top Bid
              </button>
              <button 
                className={`valuation-toggle-btn ${valuationMethod === 'floor' ? 'active' : ''}`}
                onClick={() => setValuationMethod('floor')}
                title="Valuation based on floor price"
              >
                Floor Price
              </button>
            </div>
          </div>
          <div className="valuation-note">
            {valuationMethod === 'topBid' 
              ? "* Valued by instant exit bids (backed by real capital)" 
              : "* Valued by floor listings (minimum ask price)"}
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
                        <span className="native-price">
                          {col.floorPrice > 0 ? (
                            `${col.floorPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE`
                          ) : (
                            <span className="empty-placeholder">--</span>
                          )}
                        </span>
                        {col.floorPrice > 0 && movePrice > 0 && (
                          <span className="usd-price">
                            {hideValues ? '***' : formatCurrencyValue(convertUSD(col.floorPrice * movePrice))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="native-price">
                        {col.topBid > 0 ? (
                          `${col.topBid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MOVE`
                        ) : (
                          <span className="empty-placeholder">--</span>
                        )}
                      </span>
                    </td>
                    <td className="text-center">
                      <a
                        href={tradeportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tradeport-link-icon"
                        title="View Collection on Tradeport"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
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
