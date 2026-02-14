// src/config/adapters/yuzu.js
// Yuzu Swap - CLMM DEX on Movement Network
// Website: https://yuzu.swap
// Contract: 0x4bf51972879e3b95c4781a5cdcb9e1ee24ef483e7d22f2d903626f126df62bd1

export const yuzuAdapter = [
  {
    id: "yuzu_liquidity",
    name: "Yuzu LP Position",
    type: "Liquidity",
    
    // CLMM positions stored in Position resource
    searchString: "::clmm::Position",

    parse: (data) => {
      // CLMM positions have liquidity amount
      const rawLiquidity = Number(data.liquidity || data.amount || 0);
      
      if (rawLiquidity <= 0) return "0";
      
      // Display raw liquidity units (CLMM math is complex)
      return rawLiquidity.toLocaleString();
    }
  },
  {
    id: "yuzu_lp_token",
    name: "Yuzu LP Token",
    type: "Liquidity",
    
    // Standard AMM LP tokens
    searchString: "::pool::LPCoin",

    parse: (data) => {
      const balance = Number(data.coin?.value || data.value || data.amount || 0);
      return (balance / 1000000).toFixed(4);
    }
  },
  {
    id: "yuzu_farming",
    name: "Yuzu Yield Farming",
    type: "Farming",
    
    // Staked LP in farming
    searchString: "::farming::",
    
    parse: (data) => {
      const staked = data.staked_amount || data.amount || data.deposited || 0;
      return (Number(staked) / 100000000).toFixed(4);
    }
  }
];