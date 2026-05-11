import React from 'react';
import { NFTAsset } from '../../hooks/useNFTs';

interface NFTCardProps {
  nft: NFTAsset;
  delay: number;
  convertUSD?: (val: number) => number;
  formatCurrencyValue?: (val: number) => string;
  hideValues?: boolean;
}

const NFTCard: React.FC<NFTCardProps> = ({ 
  nft, 
  delay,
  convertUSD,
  formatCurrencyValue,
  hideValues
}) => {
  const data = nft.current_token_data;
  const collection = data?.current_collection;
  
  // Try to get a valid image URI
  let imageUri = data?.token_uri || '';
  if (imageUri.startsWith('ipfs://')) {
    imageUri = imageUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }

  // Handle Arweave images
  if (imageUri.startsWith('ar://')) {
    imageUri = imageUri.replace('ar://', 'https://arweave.net/');
  }

  const floorPrice = nft.floorPrice || 0;
  const usdValue = nft.usdValue || 0;
  const convertedValue = convertUSD ? convertUSD(usdValue) : usdValue;
  const displayValue = hideValues ? '***' : (formatCurrencyValue ? formatCurrencyValue(convertedValue) : `$${usdValue.toFixed(2)}`);

  return (
    <div 
      className="nft-card" 
      style={{ 
        animationDelay: `${delay}ms` 
      } as React.CSSProperties}
    >
      <div className="nft-image-container">
        {imageUri ? (
          <img 
            src={imageUri} 
            alt={data?.token_name} 
            className="nft-image"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/movement-logo.svg';
              (e.target as HTMLImageElement).classList.add('error');
            }}
          />
        ) : (
          <div className="nft-placeholder">
            <span>{data?.token_name?.charAt(0) || 'N'}</span>
          </div>
        )}
      </div>
      <div className="nft-info">
        <div className="nft-collection-row">
          <span className="nft-collection">{collection?.collection_name || 'Unknown Collection'}</span>
          {floorPrice > 0 && (
            <span className="nft-floor-tag">{floorPrice} MOVE</span>
          )}
        </div>
        <div className="nft-name-row">
          <span className="nft-name">{data?.token_name || 'Unnamed NFT'}</span>
          {usdValue > 0 && (
            <span className="nft-value-tag">{displayValue}</span>
          )}
        </div>
      </div>
      <div className="nft-card-shine" />
    </div>
  );
};

export default React.memo(NFTCard);
