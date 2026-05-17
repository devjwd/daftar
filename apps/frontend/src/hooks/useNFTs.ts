import { useState, useEffect, useCallback, useMemo } from 'react';
import { getUserNFTHoldings } from '../services/indexer';
import { getNFTCollectionStats } from '../services/api';
import { devLog } from '../utils/devLogger';

export interface NFTAsset {
  token_data_id: string;
  amount: string;
  property_version_v1: string;
  current_token_data: {
    collection_id: string;
    token_name: string;
    description: string;
    token_uri: string;
    token_properties: any;
    current_collection: {
      collection_name: string;
      creator_address: string;
      description: string;
    };
  };
  floorPrice?: number; // In MOVE
  topBid?: number; // In MOVE
  usdValue?: number;
}

export interface GroupedNFTCollection {
  collectionId: string;
  collectionName: string;
  count: number;
  imageUri: string;
  sampleImages: string[];
  floorPrice: number;
  topBid: number;
  totalUsdValue: number;
}

export const useNFTs = (address: string | null, movePrice: number = 0, valuationMethod: 'topBid' | 'floor' = 'topBid') => {
  const [nfts, setNfts] = useState<NFTAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionStats, setCollectionStats] = useState<Record<string, { floor: number; topBid: number }>>({});

  const fetchNFTs = useCallback(async () => {
    if (!address) {
      setNfts([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getUserNFTHoldings(address);
      const holdings = data || [];

      // Extract unique collection IDs
      const collectionIds = Array.from(new Set(
        holdings
          .map(h => h.current_token_data?.collection_id)
          .filter(id => !!id)
      )) as string[];

      // Fetch pitched floor prices and top bids from our server
      const stats = await getNFTCollectionStats();
      setCollectionStats(stats);

      setNfts(holdings);
    } catch (err) {
      devLog("Error fetching NFTs:", err);
      setError("Failed to fetch NFTs");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchNFTs();
  }, [fetchNFTs]);

  const nftsWithValues = useMemo(() => {
    const scamKeywords = [
      "airdrop", "gift", "reward", "voucher", "ticket", "claim",
      "winner", "whitelist", "free", "giveaway", "bonus", "promo",
      "verification", "mint pass"
    ];

    const domainExtensions = [".xyz", ".com", ".net", ".org", ".info", ".live", ".io", "giftmove", "movedrops", "movereward"];

    // LP NFTs that are already tracked in DeFi/Liquidity sections
    const lpKeywords = ["yuzu", "meridian"];

    return nfts
      .filter(nft => {
        const name = (nft.current_token_data?.token_name || "").toLowerCase();
        const collectionName = (nft.current_token_data?.current_collection?.collection_name || "").toLowerCase();
        const description = (nft.current_token_data?.description || "").toLowerCase();

        const isScamKeyword = scamKeywords.some(keyword =>
          name.includes(keyword) || collectionName.includes(keyword) || description.includes(keyword)
        );

        const isDomainScam = domainExtensions.some(ext =>
          name.includes(ext) || collectionName.includes(ext)
        );

        const isLpNft = lpKeywords.some(keyword =>
          name.includes(keyword) || collectionName.includes(keyword)
        );

        // Return false if it matches any scam pattern or is an LP NFT
        return !(isScamKeyword || isDomainScam || isLpNft);
      })
      .map(nft => {
        const collectionId = nft.current_token_data?.collection_id;
        const stats = collectionStats[collectionId] || { floor: 0, topBid: 0 };
        const amount = parseFloat(nft.amount) || 1;
        
        // Select price based on the selected valuation method, falling back to the other if one is zero
        const price = valuationMethod === 'topBid' ? (stats.topBid || stats.floor) : (stats.floor || stats.topBid);
        const usdValue = price * amount * movePrice;

        return {
          ...nft,
          floorPrice: stats.floor,
          topBid: stats.topBid,
          usdValue: usdValue
        };
      });
  }, [nfts, collectionStats, movePrice]);

  const groupedCollections = useMemo(() => {
    const groups: Record<string, GroupedNFTCollection> = {};

    nftsWithValues.forEach(nft => {
      const collectionId = nft.current_token_data?.collection_id || 'unknown';
      const collectionName = nft.current_token_data?.current_collection?.collection_name || 'Unknown Collection';
      
      if (!groups[collectionId]) {
        groups[collectionId] = {
          collectionId,
          collectionName,
          count: 0,
          imageUri: nft.current_token_data?.token_uri || '',
          sampleImages: [],
          floorPrice: nft.floorPrice || 0,
          topBid: nft.topBid || 0,
          totalUsdValue: 0
        };
      }

      groups[collectionId].count += parseInt(nft.amount) || 1;
      groups[collectionId].totalUsdValue += nft.usdValue || 0;
      
      if (groups[collectionId].sampleImages.length < 4 && nft.current_token_data?.token_uri) {
        if (!groups[collectionId].sampleImages.includes(nft.current_token_data.token_uri)) {
          groups[collectionId].sampleImages.push(nft.current_token_data.token_uri);
        }
      }
    });

    return Object.values(groups).sort((a, b) => b.totalUsdValue - a.totalUsdValue);
  }, [nftsWithValues]);

  const totalWorth = useMemo(() => {
    return nftsWithValues.reduce((sum, nft) => sum + (nft.usdValue || 0), 0);
  }, [nftsWithValues]);

  const totalWorthMove = useMemo(() => {
    return nftsWithValues.reduce((sum, nft) => {
      const stats = collectionStats[nft.current_token_data?.collection_id] || { floor: 0, topBid: 0 };
      const price = valuationMethod === 'topBid' ? (stats.topBid || stats.floor) : (stats.floor || stats.topBid);
      const amount = parseFloat(nft.amount) || 1;
      return sum + (price * amount);
    }, 0);
  }, [nftsWithValues, collectionStats, valuationMethod]);

  return {
    nfts: nftsWithValues,
    groupedCollections,
    totalWorth,
    totalWorthMove,
    loading,
    error,
    refresh: fetchNFTs
  };
};
