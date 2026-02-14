// src/config/adapters/razor.js
// Razor DEX - AMM & Liquidity Protocol on Movement Network
// Website: https://razor.exchange

export const razorAdapter = [
  {
    id: "razor_lp",
    name: "Razor LP",
    type: "Liquidity",
    
    // Razor LP tokens stored in CoinStore
    searchString: "::swap::LPCoin",
    
    parse: (data) => {
      let value = 0;
      
      // Standard Move coin structure
      if (data.coin?.value !== undefined) {
        value = Number(data.coin.value);
      } else if (data.value !== undefined) {
        value = Number(data.value);
      } else if (data.amount !== undefined) {
        value = Number(data.amount);
      }
      
      // LP tokens typically use 6 decimals
      return (value / 1000000).toFixed(4);
    }
  },
  {
    id: "razor_staking",
    name: "Razor Staking",
    type: "Staking",
    
    // Staking positions if available
    searchString: "::staking::",
    
    parse: (data) => {
      const amount = data.staked_amount || data.amount || data.value || data.balance?.value || 0;
      return (Number(amount) / 100000000).toFixed(4);
    }
  },
  {
    id: "razor_farm",
    name: "Razor Farm",
    type: "Farming",
    
    // Yield farming positions
    searchString: "::farm::",
    
    parse: (data) => {
      const staked = data.staked || data.deposited || data.amount || 0;
      return (Number(staked) / 100000000).toFixed(4);
    }
  }
];
