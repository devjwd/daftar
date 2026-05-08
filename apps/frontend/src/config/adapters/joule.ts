import { resolveTokenPrice } from "../../utils/price";

export const jouleAdapter = [
  {
    id: "joule_supply",
    name: "Joule Supply",
    type: "Lending",
    protocol: "Joule",
    
    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const userMap = resources.find(r => r.type.includes("::pool::UserPositionsMap"));
      if (!userMap) return [];
      
      const positions = [];
      const positionsMap = userMap.data.positions_map?.data || [];
      
      positionsMap.forEach(position => {
        const lendPositions = position.value?.lend_positions?.data || [];
        lendPositions.forEach(lend => {
          const coinType = lend.key;
          const amount = Number(lend.value || 0);
          if (amount > 0) {
            const parts = coinType.split("::");
            const symbol = parts[parts.length - 1] || "Unknown";
            const displayAmount = amount / 1e8;
            const price = resolveTokenPrice(priceMap, coinType, symbol === "AptosCoin" ? "MOVE" : symbol);
            const usdValue = displayAmount * price;

            positions.push({
              id: `joule_supply_${coinType}`,
              name: "Joule Supply",
              type: "Lending",
              tokenSymbol: symbol === "AptosCoin" ? "MOVE" : symbol,
              numericValue: usdValue,
              value: displayAmount.toFixed(4),
              protocol: "joule",
              protocolName: "Joule Finance",
              protocolWebsite: "https://joule.finance"
            });
          }
        });
      });
      return positions;
    },
  },
  {
    id: "joule_borrow",
    name: "Joule Borrow",
    type: "Debt",
    protocol: "Joule",

    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const userMap = resources.find(r => r.type.includes("::pool::UserPositionsMap"));
      if (!userMap) return [];
      
      const positions = [];
      const positionsMap = userMap.data.positions_map?.data || [];
      
      positionsMap.forEach(position => {
        const borrowPositions = position.value?.borrow_positions?.data || [];
        borrowPositions.forEach(borrow => {
          const coinType = borrow.key;
          const amount = Number(borrow.value?.borrow_amount || 0);
          if (amount > 0) {
            const parts = coinType.split("::");
            const symbol = parts[parts.length - 1] || "Unknown";
            const displayAmount = amount / 1e8;
            const price = resolveTokenPrice(priceMap, coinType, symbol === "AptosCoin" ? "MOVE" : symbol);
            const usdValue = displayAmount * price;

            positions.push({
              id: `joule_borrow_${coinType}`,
              name: "Joule Borrow",
              type: "Debt",
              tokenSymbol: symbol === "AptosCoin" ? "MOVE" : symbol,
              numericValue: usdValue,
              value: displayAmount.toFixed(4),
              protocol: "joule",
              protocolName: "Joule Finance",
              protocolWebsite: "https://joule.finance"
            });
          }
        });
      });
      return positions;
    },
  },
  {
    id: "joule_rewards",
    name: "Joule Rewards",
    type: "Rewards",
    protocol: "Joule",

    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const userPools = resources.find(r => r.type.includes("::rewards::UserPoolsMap"));
      if (!userPools) return [];
      
      const positions = [];
      const poolsMap = userPools.data.user_pools_map?.data || [];
      
      poolsMap.forEach(pool => {
        const stakeAmount = Number(pool.value?.stake_amount || 0);
        if (stakeAmount > 0) {
          const coinName = pool.value?.coin_name || pool.key;
          const parts = coinName.split("::");
          let symbol = parts[parts.length - 1] || "Unknown";
          symbol = symbol.replace(/\d+$/, ''); 
          const displayAmount = stakeAmount / 1e8;
          const price = resolveTokenPrice(priceMap, coinName, symbol === "AptosCoin" ? "MOVE" : symbol);
          const usdValue = displayAmount * price;
          
          positions.push({
            id: `joule_rewards_${coinName}`,
            name: "Joule Rewards",
            type: "Rewards",
            tokenSymbol: symbol === "AptosCoin" ? "MOVE" : symbol,
            numericValue: usdValue,
            value: displayAmount.toFixed(4),
            protocol: "joule",
            protocolName: "Joule Finance",
            protocolWebsite: "https://joule.finance"
          });
        }
      });
      return positions;
    }
  }
];
