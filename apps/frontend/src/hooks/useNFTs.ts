import { useState, useEffect, useCallback, useMemo } from 'react';
import { getUserNFTHoldings } from '../services/indexer';
import { getCollectionFloorPrices } from '../services/tradeport';
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
  usdValue?: number;
}

export const useNFTs = (address: string | null, movePrice: number = 0) => {
  const [nfts, setNfts] = useState<NFTAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floorPrices, setFloorPrices] = useState<Record<string, number>>({});

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

      // Fetch floor prices from Tradeport
      if (collectionIds.length > 0) {
        const floors = await getCollectionFloorPrices(collectionIds);
        setFloorPrices(floors);
      }

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
        const floor = floorPrices[collectionId] || 0;
        const amount = parseFloat(nft.amount) || 1;
        const usdValue = floor * amount * movePrice;

        return {
          ...nft,
          floorPrice: floor,
          usdValue: usdValue
        };
      });
  }, [nfts, floorPrices, movePrice]);

  const totalWorth = useMemo(() => {
    return nftsWithValues.reduce((sum, nft) => sum + (nft.usdValue || 0), 0);
  }, [nftsWithValues]);

  return {
    nfts: nftsWithValues,
    totalWorth,
    loading,
    error,
    refresh: fetchNFTs
  };
};
