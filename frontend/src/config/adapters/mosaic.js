// src/config/adapters/mosaic.js

export const mosaicAdapter = [
    // --- 1. Standard Liquidity Pools (LP Tokens) ---
    {
      id: "mosaic_lp",
      name: "Mosaic LP",
      type: "Liquidity",
      // Look for standard LP resources. 
      // In Move, Uniswap V2 clones usually use a generic "LPCoin" resource.
      // ⚠️ You must confirm the exact address from Explorer, but it likely looks like:
      // "0x[MOSAIC_ADDRESS]::amm::LPCoin" or "::swap::LPCoin"
      searchString: "::swap::LPCoin", 
  
      parse: (data) => {
        // Data usually comes as just a raw balance number
        const rawBalance = Number(data.value);
        
        // LP tokens usually have 6 or 8 decimals depending on the protocol
        // For a simple tracker, we show the raw unit count or a simplified number.
        return (rawBalance / 1000000).toFixed(4);
      }
    },
    
    // --- 2. Yield Farming (Staked LPs) ---
    {
      id: "mosaic_farm",
      name: "Mosaic Farm",
      type: "Farming",
      // When you stake LPs, you get a "UserInfo" or "StakeInfo" resource in return.
      // Look for: "0x[MOSAIC_ADDRESS]::masterchef::UserInfo" or "::farming::UserStake"
      searchString: "::farming::UserInfo",
  
      parse: (data) => {
        // Farming structs usually look like: { amount: "10000", reward_debt: "..." }
        const stakedAmount = Number(data.amount);
        return (stakedAmount / 1000000).toFixed(4);
      }
    }
  ];