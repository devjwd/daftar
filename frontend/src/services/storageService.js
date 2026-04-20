/**
 * Storage Service
 * 
 * Handles decentralized metadata persistence for SBT badges.
 * Supports IPFS pinning (via Pinata or generic nodes) to ensure badges 
 * remain permanent even if the centralized server goes offline.
 */

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

/**
 * Pins JSON metadata to IPFS.
 * This normally happens server-side via an Edge Function to protect API keys.
 */
export const pinMetadataToIPFS = async (metadata) => {
  try {
    // In a production environment, this calls a Supabase Edge Function
    // which holds the Pinata JWT. 
    const response = await fetch('/api/storage/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });

    if (!response.ok) {
      throw new Error(`IPFS pinning failed: ${response.statusText}`);
    }

    const { ipfsHash } = await response.json();
    return {
      success: true,
      ipfsHash,
      uri: `ipfs://${ipfsHash}`,
      gatewayUrl: `${IPFS_GATEWAY}${ipfsHash}`
    };
  } catch (error) {
    console.error('[storageService] Failed to pin to IPFS:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Resolves an IPFS URI to a public gateway URL.
 */
export const resolveIPFS = (uri) => {
  if (!uri || typeof uri !== 'string') return uri;
  if (uri.startsWith('ipfs://')) {
    return `${IPFS_GATEWAY}${uri.replace('ipfs://', '')}`;
  }
  return uri;
};

/**
 * Formats a metadata object for Opensea/Marketplace compatibility.
 */
export const formatNFTMetadata = (badge) => {
  return {
    name: badge.name,
    description: badge.description,
    image: badge.imageUrl,
    external_url: `https://daftar.fi/badges/${badge.id}`,
    attributes: [
      { trait_type: 'Category', value: badge.category },
      { trait_type: 'Rarity', value: badge.rarity },
      { trait_type: 'XP Value', value: badge.xp },
      ...(badge.metadata?.attributes || [])
    ]
  };
};
