/**
 * NFT Holder Criteria Evaluator
 * 
 * Checks if user holds NFTs (optionally from a specific collection).
 */
import { getUserNFTHoldings } from '../../indexer.js';

export const meta = {
  type: 'nft_holder',
  name: 'NFT Holder',
  description: 'Requires holding NFTs (optionally from a specific collection)',
  icon: '🖼️',
};

/**
 * @param {string} address      - User wallet address
 * @param {object} params       - { collectionName?: string, minCount?: number }
 * @returns {Promise<{ eligible: boolean, current: number, required: number, progress: number }>}
 */
export async function evaluate(address, params) {
  const { collectionName = '', minCount = 1 } = params || {};
  const required = Math.max(1, Number(minCount) || 1);

  try {
    const nfts = await getUserNFTHoldings(address);
    let filtered = Array.isArray(nfts) ? nfts : [];

    if (collectionName && collectionName.trim()) {
      const target = collectionName.trim().toLowerCase();
      filtered = filtered.filter(nft => {
        const name = String(nft.collection_name || nft.current_collection?.collection_name || '').toLowerCase();
        return name.includes(target);
      });
    }

    const count = filtered.length;

    return {
      eligible: count >= required,
      current: count,
      required,
      progress: required > 0 ? Math.min(100, Math.round((count / required) * 100)) : 100,
      label: collectionName
        ? `${count} / ${required} NFTs from "${collectionName}"`
        : `${count} / ${required} NFTs`,
    };
  } catch (error) {
    console.warn('[criteria:nft_holder] evaluation failed:', error.message);
    return { eligible: false, current: 0, required, progress: 0, label: 'Check failed', error: error.message };
  }
}
