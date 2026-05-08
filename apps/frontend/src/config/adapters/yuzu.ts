// src/config/adapters/yuzu.ts
// Yuzu Swap - CLMM DEX on Movement Network
// Website: https://yuzu.swap
// Contract: 0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a

import { getUserNFTHoldings, getYuzuLiquidityPositions } from "../../services/indexer";
import { devLog } from "../../utils/devLogger";
import { resolveTokenPrice } from "../../utils/price";

import { sharedPoolCache } from "../../utils/sharedPoolCache";

const YUZU_NFT_MANAGER = '0x1d0434ae92598710f5ccbfbf51cf66cf2fe8ba8e77381bed92f45bb32d237bc2';
const YUZU_PACKAGE = '0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a';

const fetchYuzuPositionAmounts = async (client: any, poolAddress: string, positionId: string) => {
  const cacheKey = `yuzu_amounts:${poolAddress}:${positionId}`;
  return sharedPoolCache.fetch(cacheKey, async () => {
    try {
      const result = await client.view({
        payload: {
          function: `${YUZU_PACKAGE}::position_nft_manager::get_position_token_amounts`,
          typeArguments: [],
          functionArguments: [poolAddress, positionId]
        }
      });
      return result;
    } catch (err) {
      devLog(`Failed to fetch fresh Yuzu amounts for #${positionId}:`, err);
      return null;
    }
  }, 120 * 1000); // 2 minute cache
};

export const yuzuAdapter = [
  {
    id: "yuzu_clmm",
    name: "Yuzu CLMM Position",
    type: "Liquidity",
    searchString: "::clmm::Position",

    discover: async ({ client, targetAddress, priceMap }) => {
      try {
        const [nftHoldings, yuzuEvents] = await Promise.all([
          getUserNFTHoldings(targetAddress),
          getYuzuLiquidityPositions(targetAddress),
        ]);

        const yuzuLiquidityMap = {};
        for (const event of yuzuEvents) {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data && data.position_id) {
              const posId = String(data.position_id);
              if (!yuzuLiquidityMap[posId] || event.transaction_version > yuzuLiquidityMap[posId].version) {
                yuzuLiquidityMap[posId] = {
                  version: event.transaction_version,
                  liquidity: data.liquidity_delta || data.liquidity || 0,
                  amount0: data.amount_0 || data.token_0_amount || 0,
                  amount1: data.amount_1 || data.token_1_amount || 0,
                  pool: data.pool_address || data.pool || '',
                };
              }
            }
          } catch {
            // Ignore malformed Yuzu event payloads
          }
        }

        const positions = (await Promise.all(nftHoldings.map(async (nft) => {
          const collectionName = nft.current_token_data?.current_collection?.collection_name || '';
          const creatorAddress = nft.current_token_data?.current_collection?.creator_address || '';
          const tokenName = nft.current_token_data?.token_name || '';

          const isYuzuPosition =
            collectionName.toLowerCase().includes('yuzu') ||
            collectionName.toLowerCase().includes('liquidity position') ||
            creatorAddress.toLowerCase() === YUZU_NFT_MANAGER;

          if (isYuzuPosition) {
            const positionId = tokenName.replace(/[^0-9]/g, '');
            const eventData = yuzuLiquidityMap[positionId];
            const poolAddress = eventData?.pool || creatorAddress;

            let poolPair = 'LP Position';
            const collectionMatch = collectionName.match(/\|\s*([A-Za-z0-9.]+\/[A-Za-z0-9.]+)\s*\|/i);
            if (collectionMatch) {
              poolPair = collectionMatch[1].replace('/', ' / ');
            }

            const tokens = poolPair.split('/').map(t => t.trim().replace(/\.e$/, '').toUpperCase());
            const getTokenDecimals = (symbol) => {
              if (['USDC', 'USDCX', 'USDT', 'USDA', 'USDE', 'DAI'].includes(symbol)) return 6;
              return 8;
            };

            const decimals0 = tokens[0] ? getTokenDecimals(tokens[0]) : 8;
            const decimals1 = tokens[1] ? getTokenDecimals(tokens[1]) : 8;

            let token0Amount = 0;
            let token1Amount = 0;

            if (eventData) {
              token0Amount = Number(eventData.amount0 || 0) / Math.pow(10, decimals0);
              token1Amount = Number(eventData.amount1 || 0) / Math.pow(10, decimals1);
            }

            // Enrichment: Fetch fresh amounts from pool if possible (Async View call)
            if (positionId && client) {
              const result = await fetchYuzuPositionAmounts(client, poolAddress, positionId);
              if (result && result.length >= 2) {
                token0Amount = Number(result[0]) / Math.pow(10, decimals0);
                token1Amount = Number(result[1]) / Math.pow(10, decimals1);
              }
            }

            const p0 = resolveTokenPrice(priceMap, undefined, tokens[0]);
            const p1 = resolveTokenPrice(priceMap, undefined, tokens[1]);

            let liquidityValue = 0;
            if (p0 > 0 || p1 > 0) {
              liquidityValue = (token0Amount * p0) + (token1Amount * p1);
            } else {
              // Fallback for MOVE pairs
              const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
              liquidityValue = (token0Amount + token1Amount) * movePrice;
            }

            return {
              id: `yuzu_nft_${positionId}`,
              name: poolPair,
              type: "Liquidity",
              value: liquidityValue.toFixed(2),
              numericValue: liquidityValue,
              tokenSymbol: "YUZ-LP",
              symbol: `YUZ-LP #${positionId}`,
              protocolName: "Yuzu Swap",
              protocol: "yuzu",
              protocolWebsite: "https://yuzu.swap",
              source: "indexer",
              poolAddress,
              token0Amount,
              token1Amount,
              usdValue: liquidityValue,
              liquidityValue,
              isNFT: true,
              positionId,
              underlying: poolPair,
              amount: 1,
            };
          }
          return null;
        }))).filter(Boolean);
        return positions;
      } catch (err) {
        devLog("Yuzu discovery error:", err);
        return [];
      }
    },

    parse: (data) => {
      const rawLiquidity = Number(data.liquidity || data.amount || 0);
      if (rawLiquidity <= 0) return "0";
      return (rawLiquidity / 1e6).toFixed(2);
    }
  },
  {
    id: "yuzu_lp_token",
    name: "Yuzu LP Token",
    type: "Liquidity",
    searchString: "::pool::LPCoin",
    parse: (data) => {
      const balance = Number(data.coin?.value || data.value || data.amount || 0);
      return (balance / 1e6).toFixed(4);
    }
  },
  {
    id: "yuzu_farming",
    name: "Yuzu Yield Farming",
    type: "Farming",
    searchString: "::farming::",
    parse: (data) => {
      const staked = data.staked_amount || data.amount || data.deposited || 0;
      return (Number(staked) / 1e8).toFixed(4);
    }
  }
];
