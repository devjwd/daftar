// src/config/adapters/moveposition.ts
// MovePosition Protocol - Lending & Borrowing on Movement Network
// Contract: 0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf

import { devLog } from "../../utils/devLogger";
import { resolveTokenPrice } from "../../utils/price";

const MOVEPOSITION_CONTRACT = "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf";

const MOVEPOSITION_TOKENS = {
  MOVE: { symbol: "MOVE", coinType: `${MOVEPOSITION_CONTRACT}::coins::MOVE`, decimals: 8 },
  USDC: { symbol: "USDC.e", coinType: `${MOVEPOSITION_CONTRACT}::coins::USDC`, decimals: 6 },
  USDT: { symbol: "USDT.e", coinType: `${MOVEPOSITION_CONTRACT}::coins::USDT`, decimals: 6 },
  WETH: { symbol: "WETH.e", coinType: `${MOVEPOSITION_CONTRACT}::coins::WETH`, decimals: 8 },
  WBTC: { symbol: "WBTC.e", coinType: `${MOVEPOSITION_CONTRACT}::coins::WBTC`, decimals: 8 },
};

const decodeTokenInfo = (hexString: string) => {
  try {
    if (!hexString || !hexString.startsWith("0x")) return null;
    const hex = hexString.slice(2);
    let decoded = "";
    for (let i = 0; i < hex.length; i += 2) {
      decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    const match = decoded.match(/::coins::(\w+)>/);
    if (match) {
      const rawSymbol = match[1];
      const symbol = rawSymbol === "USDC" ? "USDC.e" : rawSymbol === "USDT" ? "USDT.e" : rawSymbol === "WETH" ? "WETH.e" : rawSymbol === "WBTC" ? "WBTC.e" : rawSymbol;
      const coinType = `${MOVEPOSITION_CONTRACT}::coins::${rawSymbol}`;
      return { symbol, coinType };
    }
    return null;
  } catch {
    return null;
  }
};

const getDecimals = (symbol: string) => {
  const s = symbol.toUpperCase().replace(/\.E$/i, "");
  if (s === "USDC" || s === "USDT") return 6;
  return 8;
};

export const movePositionAdapter = [
  {
    id: "moveposition_portfolio",
    name: "MovePosition Portfolio",
    type: "Lending",
    searchString: "::portfolio::Portfolio",

    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const portfolioResource = resources.find(r => r.type.includes("::portfolio::Portfolio"));
      if (!portfolioResource) return [];

      const data = portfolioResource.data;
      const positions = [];

      // Process Supplies (Collaterals)
      const collateralItems = data.collaterals?.items || [];
      const collateralKeys = data.collaterals?.keys?.items || [];

      await Promise.all(collateralKeys.map(async (key, idx) => {
        const notes = collateralItems[idx];
        if (!notes || Number(notes) <= 0) return;

        const tokenInfo = decodeTokenInfo(key?.struct_name);
        if (!tokenInfo) return;

        try {
          const result = await client.view({
            payload: {
              function: `${MOVEPOSITION_CONTRACT}::broker::calc_coins_from_dnotes`,
              typeArguments: [tokenInfo.coinType],
              functionArguments: [notes]
            }
          });
          const amount = Number(result[0]);
          const decimals = getDecimals(tokenInfo.symbol);
          const displayAmount = amount / Math.pow(10, decimals);
          if (displayAmount < 0.0001) return;

          const price = resolveTokenPrice(priceMap, tokenInfo.coinType, tokenInfo.symbol);
          const usdValue = displayAmount * price;

          positions.push({
            id: `moveposition_supply_${tokenInfo.symbol.toLowerCase()}`,
            name: `MovePosition Supply`,
            type: "Lending",
            value: displayAmount.toFixed(4),
            numericValue: usdValue,
            tokenSymbol: tokenInfo.symbol,
            protocol: "moveposition",
            protocolName: "MovePosition",
            protocolWebsite: "https://moveposition.xyz",
            source: "view",
            underlying: tokenInfo.symbol,
            usdValue: usdValue,
            amount: displayAmount
          });
        } catch (e) {
          devLog("MovePosition supply view error:", e);
        }
      }));

      // Process Borrows (Liabilities)
      const liabilityItems = data.liabilities?.items || [];
      const liabilityKeys = data.liabilities?.keys?.items || [];

      await Promise.all(liabilityKeys.map(async (key, idx) => {
        const notes = liabilityItems[idx];
        if (!notes || Number(notes) <= 0) return;

        const tokenInfo = decodeTokenInfo(key?.struct_name);
        if (!tokenInfo) return;

        try {
          const result = await client.view({
            payload: {
              function: `${MOVEPOSITION_CONTRACT}::broker::calc_coins_from_lnotes`,
              typeArguments: [tokenInfo.coinType],
              functionArguments: [notes]
            }
          });
          const amount = Number(result[0]);
          const decimals = getDecimals(tokenInfo.symbol);
          const displayAmount = amount / Math.pow(10, decimals);
          if (displayAmount < 0.0001) return;

          const price = resolveTokenPrice(priceMap, tokenInfo.coinType, tokenInfo.symbol);
          const usdValue = displayAmount * price;

          positions.push({
            id: `moveposition_debt_${tokenInfo.symbol.toLowerCase()}`,
            name: `MovePosition Debt`,
            type: "Debt",
            value: displayAmount.toFixed(4),
            numericValue: usdValue,
            tokenSymbol: tokenInfo.symbol,
            protocol: "moveposition",
            protocolName: "MovePosition",
            protocolWebsite: "https://moveposition.xyz",
            source: "view",
            underlying: tokenInfo.symbol,
            usdValue: usdValue,
            amount: displayAmount
          });
        } catch (e) {
          devLog("MovePosition debt view error:", e);
        }
      }));

      return positions;
    },

    parse: (data) => {
      // Fallback parser if view functions fail
      return null; 
    }
  }
];
