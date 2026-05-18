// src/config/adapters/echelon.ts
// Echelon Finance - Leading Lending Protocol on Movement Network
// Contract: 0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5

import { devLog } from "../../utils/devLogger";
import { resolveTokenPrice } from "../../utils/price";

const ECHELON_CONTRACT = "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5";

const getAssetInfo = (assetName: string) => {
  let name = String(assetName || "").trim().toUpperCase();
  
  // Clean up common suffixes
  name = name.replace(/COIN$/i, '').trim();
  
  if (name.includes("SUSDE") || name.includes("USDC") || name.includes("USDT")) {
    return { 
      symbol: name.includes("SUSDE") ? "sUSDe" : name.includes("USDC") ? "USDC.e" : "USDT.e", 
      decimals: 6 
    };
  }

  if (name.includes("WETH") || name.includes("WBTC")) {
    return {
      symbol: name.includes("WETH") ? "WETH.e" : "WBTC.e",
      decimals: 8
    };
  }
  
  // Default to MOVE if name is empty after stripping COIN or if it's exactly COIN
  return { symbol: name || "MOVE", decimals: 8 };
};

export const echelonAdapter = [
  {
    id: "echelon_lending",
    name: "Echelon Position",
    type: "Lending",
    searchString: "::lending::Vault",

    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const vault = resources.find(r => r.type.includes("::lending::Vault") && r.type.includes(ECHELON_CONTRACT));
      if (!vault) return [];

      const positions = [];
      const collaterals = vault.data.collaterals?.data || [];
      const liabilities = vault.data.liabilities?.data || [];

      // Process Collaterals
      await Promise.all(collaterals.map(async (c) => {
        const market = c.key?.inner;
        if (!market || Number(c.value) <= 0) return;

        try {
          const [nameRes, coinsRes] = await Promise.all([
            client.view({ payload: { function: `${ECHELON_CONTRACT}::lending::market_asset_name`, typeArguments: [], functionArguments: [market] } }),
            client.view({ payload: { function: `${ECHELON_CONTRACT}::lending::account_coins`, typeArguments: [], functionArguments: [targetAddress, market] } })
          ]);

          const { symbol, decimals } = getAssetInfo(nameRes[0]);
          const displayAmount = Number(coinsRes[0]) / Math.pow(10, decimals);
          if (displayAmount < 0.0001) return;

          const price = resolveTokenPrice(priceMap, market, symbol);
          const usdValue = displayAmount * price;

          positions.push({
            id: `echelon_supply_${symbol.toLowerCase()}`,
            name: `Echelon Supply`,
            type: "Lending",
            value: displayAmount.toFixed(4),
            numericValue: usdValue,
            tokenSymbol: symbol,
            protocol: "echelon",
            protocolName: "Echelon",
            protocolWebsite: "https://app.echelon.market",
            source: "view",
            underlying: symbol,
            usdValue,
            amount: displayAmount
          });
        } catch (e) { devLog("Echelon supply view error", e); }
      }));

      // Process Liabilities
      await Promise.all(liabilities.map(async (l) => {
        const market = l.key?.inner;
        if (!market || Number(l.value?.principal) <= 0) return;

        try {
          const [nameRes, debtRes] = await Promise.all([
            client.view({ payload: { function: `${ECHELON_CONTRACT}::lending::market_asset_name`, typeArguments: [], functionArguments: [market] } }),
            client.view({ payload: { function: `${ECHELON_CONTRACT}::lending::account_liability`, typeArguments: [], functionArguments: [targetAddress, market] } })
          ]);

          const { symbol, decimals } = getAssetInfo(nameRes[0]);
          const displayAmount = Number(debtRes[0]) / Math.pow(10, decimals);
          if (displayAmount < 0.0001) return;

          const price = resolveTokenPrice(priceMap, market, symbol);
          const usdValue = displayAmount * price;

          positions.push({
            id: `echelon_debt_${symbol.toLowerCase()}`,
            name: `Echelon Debt`,
            type: "Debt",
            value: displayAmount.toFixed(4),
            numericValue: usdValue,
            tokenSymbol: symbol,
            protocol: "echelon",
            protocolName: "Echelon",
            protocolWebsite: "https://app.echelon.market",
            source: "view",
            underlying: symbol,
            usdValue,
            amount: displayAmount
          });
        } catch (e) { devLog("Echelon debt view error", e); }
      }));

      return positions;
    }
  }
];
