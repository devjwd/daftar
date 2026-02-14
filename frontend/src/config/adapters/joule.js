// src/config/adapters/joule.js
// Joule Finance - Lending & Borrowing Protocol on Movement Network
// Website: https://joule.finance
// Contract: 0x6a164188af7bb6a8268339343a5afe0242292713709af8801dafba3a054dc2f2

export const jouleAdapter = [
  {
    id: "joule_supply",
    name: "Joule Supply",
    type: "Lending",
    protocol: "Joule",
    
    // Joule stores user positions in pool::UserPositionsMap resource
    searchString: "::pool::UserPositionsMap", 

    parse: (data, resourceType) => {
      const positions = [];
      
      // UserPositionsMap has positions_map.data array
      const positionsMap = data.positions_map?.data || [];
      
      positionsMap.forEach(position => {
        // Each position has lend_positions.data array
        const lendPositions = position.value?.lend_positions?.data || [];
        
        lendPositions.forEach(lend => {
          const coinType = lend.key; // e.g., "0x1::aptos_coin::AptosCoin"
          const amount = Number(lend.value || 0);
          
          if (amount > 0) {
            // Extract token symbol from coin type
            const parts = coinType.split("::");
            const symbol = parts[parts.length - 1] || "Unknown";
            
            positions.push({
              token: symbol === "AptosCoin" ? "MOVE" : symbol,
              coinType: coinType,
              amount: amount,
              decimals: 8
            });
          }
        });
      });
      
      return positions;
    }
  },
  {
    id: "joule_borrow",
    name: "Joule Borrow",
    type: "Debt",
    protocol: "Joule",
    searchString: "::pool::UserPositionsMap", 

    parse: (data, resourceType) => {
      const positions = [];
      
      // UserPositionsMap has positions_map.data array
      const positionsMap = data.positions_map?.data || [];
      
      positionsMap.forEach(position => {
        // Each position has borrow_positions.data array
        const borrowPositions = position.value?.borrow_positions?.data || [];
        
        borrowPositions.forEach(borrow => {
          const coinType = borrow.key; // e.g., "0x1::aptos_coin::AptosCoin"
          const borrowData = borrow.value;
          const amount = Number(borrowData?.borrow_amount || 0);
          
          if (amount > 0) {
            // Extract token symbol from coin type
            const parts = coinType.split("::");
            const symbol = parts[parts.length - 1] || "Unknown";
            
            positions.push({
              token: symbol === "AptosCoin" ? "MOVE" : symbol,
              coinType: coinType,
              amount: amount,
              decimals: 8,
              interestAccumulated: Number(borrowData?.interest_accumulated || 0)
            });
          }
        });
      });
      
      return positions;
    }
  },
  {
    id: "joule_rewards",
    name: "Joule Rewards",
    type: "Rewards",
    protocol: "Joule",
    searchString: "::rewards::UserPoolsMap",

    parse: (data, resourceType) => {
      const positions = [];
      
      // UserPoolsMap has user_pools_map.data array
      const poolsMap = data.user_pools_map?.data || [];
      
      poolsMap.forEach(pool => {
        const stakeAmount = Number(pool.value?.stake_amount || 0);
        
        if (stakeAmount > 0) {
          const coinName = pool.value?.coin_name || pool.key;
          // Extract token symbol - remove numeric suffix like "AptosCoin1111"
          const parts = coinName.split("::");
          let symbol = parts[parts.length - 1] || "Unknown";
          symbol = symbol.replace(/\d+$/, ''); // Remove trailing numbers
          
          positions.push({
            token: symbol === "AptosCoin" ? "MOVE" : symbol,
            coinType: coinName,
            amount: stakeAmount,
            decimals: 8,
            poolName: pool.key
          });
        }
      });
      
      return positions;
    }
  }
];