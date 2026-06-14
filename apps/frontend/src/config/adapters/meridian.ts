// src/config/adapters/meridian.ts
// Meridian Protocol - Lending & Liquidity on Movement Network
// Website: https://meridian.money

import { devLog } from "../../utils/devLogger";
import { getUserTokenBalances } from "../../services/indexer";
import { sharedPoolCache } from "../../utils/sharedPoolCache";
import { resolveTokenPrice } from "../../utils/price";

const CACHE_TTL = 90 * 1000;

const normalizeAssetIdentifier = (value: string) => {
  if (!value) return '';
  let normalized = String(value).trim().toLowerCase();
  const genericMatch = normalized.match(/<\s*([^>]+)\s*>/);
  if (genericMatch?.[1]) {
    normalized = genericMatch[1].trim().toLowerCase();
  }
  if (normalized.includes('::')) {
    normalized = normalized.split('::')[0];
  }
  if (normalized.startsWith('0x')) {
    const compact = normalized.slice(2).replace(/^0+/, '') || '0';
    normalized = `0x${compact}`;
  }
  return normalized;
};

const fetchMeridianPoolInfo = async (client: any, poolAddress: string) => {
  const cacheKey = `meridian_pool:${poolAddress}`;
  
  return sharedPoolCache.fetch(cacheKey, async () => {
    try {
      const normalizedPool = poolAddress.trim().toLowerCase();
      const resources = await client.getAccountResources({ accountAddress: normalizedPool });

      const poolResource = resources.find((resource: any) => resource.type.includes('::pool::Pool'));
      const supplyResource = resources.find((resource: any) => resource.type === '0x1::fungible_asset::ConcurrentSupply');

      if (!poolResource || !supplyResource?.data?.current?.value) return null;

      const poolBalances = await getUserTokenBalances(normalizedPool);
      const tokens = poolBalances
        .filter((item: any) => Number(item?.amount || 0) > 0)
        .filter((item: any) => !/MER-LP|LP TOKEN|LPCOIN|MOVE Drops/i.test(String(item?.metadata?.symbol || item?.symbol || '')))
        .map((item: any) => {
          const decimals = Number(item?.metadata?.decimals ?? 8);
          const amount = item?.numericAmount !== undefined ? item.numericAmount : (Number(String(item?.rawAmount || item?.amount || 0).replace(/,/g, '')) / Math.pow(10, decimals));
          return {
            symbol: item?.metadata?.symbol || 'Token',
            decimals,
            amount,
            assetType: item?.asset_type
          };
        });

      const totalSupplyRaw = Number(supplyResource.data.current.value || 0);
      
      return {
        poolId: normalizedPool,
        totalSupplyRaw,
        tokens,
      };
    } catch (e) {
      devLog("Meridian pool fetch error", e);
      return null;
    }
  }, CACHE_TTL);
};

export const meridianAdapter = [
  {
    id: "meridian_lending",
    name: "Meridian Position",
    type: "Lending",
    searchString: "::vault::Vault",
    parse: (data: any) => {
      const collateral = data.collateral_value || data.collateral || 0;
      return (Number(collateral) / 1e8).toFixed(2);
    }
  },
  {
    id: "meridian_lp",
    name: "Meridian Liquidity Pool",
    type: "Liquidity",
    searchString: "::pool::LPCoin", // Pattern to match in resources or indexer

    discover: async ({ client, targetAddress, resources, balances, priceMap }: any) => {
      const allBalances = (balances && balances.length > 0) ? balances : await getUserTokenBalances(targetAddress);
      const lpBalances = allBalances.filter((b: any) => {
        const symbol = b.metadata?.symbol || b.symbol || '';
        const name = b.metadata?.name || b.name || '';
        return /MER-LP|Meridian LP/i.test(symbol) || /MER-LP|Meridian LP/i.test(name);
      });
      
      const positions = [];
      for (let i = 0; i < lpBalances.length; i += 3) {
        const chunk = lpBalances.slice(i, i + 3);
        const chunkResults = await Promise.all(chunk.map(async (balance) => {
          const poolAddress = balance.address || balance.asset_type;
          if (!poolAddress) return null;

          const poolInfo = await fetchMeridianPoolInfo(client, poolAddress);
          if (poolInfo) {
            const userLpRaw = Number(balance.rawAmount || balance.amount || 0);
            const userShare = userLpRaw / poolInfo.totalSupplyRaw;
            const poolTokens = poolInfo.tokens.map((t: any) => ({
              symbol: t.symbol,
              amount: t.amount * userShare,
              decimals: t.decimals
            }));

            let usdValue = 0;
            if (priceMap) {
              usdValue = poolTokens.reduce((sum: number, t: any) => {
                const price = resolveTokenPrice(priceMap, t.assetType, t.symbol);
                return sum + (t.amount * price);
              }, 0);
            }

            return {
              id: `meridian_lp_${poolAddress}`,
              protocol: "meridian",
              protocolName: "Meridian",
              symbol: balance.symbol || "MER-LP",
              name: "Meridian Liquidity Pool",
              amount: balance.numericAmount !== undefined ? balance.numericAmount : (Number(String(balance.rawAmount || balance.amount || 0).replace(/,/g, '')) / Math.pow(10, balance.decimals || 8)),
              underlying: poolTokens.map((t: any) => t.symbol).join('/'),
              usdValue,
              numericValue: usdValue,
              poolTokens,
              isMeridianLP: true,
              type: "Liquidity"
            };
          }
          return null;
        }));
        positions.push(...chunkResults);
      }
      
      const validPositions = positions.filter(Boolean);
      return validPositions;
    }
  }
];
