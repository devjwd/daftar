// src/config/adapters/canopy.ts
// Canopy Finance - Liquid Staking & DeFi on Movement Network
// Website: https://app.canopyhub.xyz/
import { resolveTokenPrice } from "../../utils/price";
import { CANOPY_CONFIG } from "../network";
import { getUserTokenBalances } from "../../services/indexer";
import { devLog } from "../../utils/devLogger";

export const canopyAdapter = [
  {
    id: "canopy_finance",
    name: "Canopy Finance",
    type: "Liquidity",
    searchString: "::vault::", // Participate in resource-based discovery

    discover: async ({ client, targetAddress, resources, balances, priceMap }) => {
      try {
        // If balances weren't passed or are empty, fetch them from indexer
        const allBalances = (balances && balances.length > 0) ? balances : await getUserTokenBalances(targetAddress);
        devLog(`Canopy: Processing ${allBalances?.length || 0} balances`);

        // 1. FA-Based Detection
        const canopyPositions = (allBalances || []).filter(b => {
          const symbol = (b.metadata?.symbol || b.symbol || '').trim().toUpperCase();
          const type = String(b.asset_type || '').toLowerCase();

          // stMOVE, stETH, CNP, CNP-LP, cvMOVE, etc.
          const isCanopy = 
            symbol === 'STMOVE' ||
            symbol === 'STETH' ||
            symbol === 'CNP' ||
            symbol.includes('CNP-LP') ||
            symbol.startsWith('CV') ||
            type.includes('canopy') ||
            (CANOPY_CONFIG.coreVaultsAddress && type.includes(CANOPY_CONFIG.coreVaultsAddress.toLowerCase()));
          
          return isCanopy;
        });
        devLog(`Canopy: Found ${canopyPositions.length} positions in balances`);

        const positions = canopyPositions.map(b => {
          const symbol = (b.metadata?.symbol || b.symbol || 'stMOVE').trim();
          const decimals = b.metadata?.decimals || 8;
          const amount = Number(b.amount || 0) / Math.pow(10, decimals);

          // Price logic using shared utility
          const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
          const ethPrice = resolveTokenPrice(priceMap, '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376', 'ETH');

          let usdValue = 0;
          if (symbol.toUpperCase().includes('MOVE')) usdValue = amount * movePrice;
          else if (symbol.toUpperCase().includes('ETH')) usdValue = amount * ethPrice;
          else usdValue = amount * resolveTokenPrice(priceMap, b.asset_type, symbol);

          return {
            id: `canopy_${b.asset_type || b.id || symbol}`,
            protocol: "canopy",
            protocolName: "Canopy Finance",
            protocolWebsite: "https://app.canopyhub.xyz/",
            symbol: symbol,
            name: symbol.toLowerCase().startsWith('st') ? `Canopy Liquid ${symbol.slice(2)}` : (symbol.toLowerCase().startsWith('cv') ? `Canopy Vault ${symbol.slice(2)}` : "Canopy Liquidity"),
            amount: amount,
            numericValue: usdValue,
            value: amount.toFixed(4),
            usdValue: usdValue,
            underlying: symbol.toLowerCase().startsWith('st') ? symbol.slice(2) : (symbol.toLowerCase().startsWith('cv') ? symbol.slice(2) : "LP Tokens"),
            type: "Liquidity"
          };
        });

        // 2. Resource-Based Detection Fallback
        if (resources && resources.length > 0) {
          const vaultResources = resources.filter(r => 
            (r.type.includes("::vault::Vault") || r.type.includes("::vault::UserInfo")) &&
            r.type.includes(String(CANOPY_CONFIG.coreVaultsAddress || '').toLowerCase())
          );

          vaultResources.forEach((res, idx) => {
            const resId = `canopy_vault_${idx}`;
            if (!positions.some(p => p.id === resId)) {
              // Basic detection for vault resources if not already found in balances
              const shares = Number(res.data?.shares || 0) / 1e8;
              if (shares > 0) {
                const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
                positions.push({
                  id: resId,
                  protocol: "canopy",
                  protocolName: "Canopy Finance",
                  symbol: "stMOVE",
                  name: "Canopy Vault Position",
                  amount: shares,
                  numericValue: shares * movePrice,
                  value: shares.toFixed(4),
                  usdValue: shares * movePrice,
                  underlying: "MOVE",
                  type: "Liquidity",
                  source: "resource"
                });
              }
            }
          });
        }

        return positions;
      } catch (err) {
        devLog("Canopy discovery error:", err);
        return [];
      }
    }
  }
];
