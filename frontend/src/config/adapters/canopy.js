// src/config/adapters/canopy.js
// Canopy - Liquid Staking Protocol on Movement Network

export const canopyAdapter = [
  {
    id: "canopy_liquid_staking",
    name: "Canopy Staked MOVE",
    type: "Staking",

    // Look for liquid staking receipt tokens (stMOVE)
    searchString: "0x1::coin::CoinStore",

    // Filter for Canopy-specific staking tokens
    filterType: (typeString) => {
      const lower = typeString.toLowerCase();
      return lower.includes("stmove") || 
             lower.includes("canopy") ||
             lower.includes("liquid_staking") ||
             lower.includes("::st::");
    },

    parse: (data) => {
      const rawBalance = Number(data.coin?.value || data.value || 0);
      return (rawBalance / 100000000).toFixed(4);
    }
  },
  
  {
    id: "canopy_vault_position",
    name: "Canopy Vault",
    type: "Yield",
    
    // Custom vault resource
    searchString: "::vault::", 

    parse: (data) => {
      const rawAmount = Number(
        data.staked_amount || 
        data.shares || 
        data.amount || 
        data.active_stake || 
        data.balance?.value ||
        0
      );
      return (rawAmount / 100000000).toFixed(4);
    }
  },
  
  {
    id: "canopy_staking_position",
    name: "Canopy Staking",
    type: "Staking",
    
    // Direct staking positions
    searchString: "::staking::",
    
    parse: (data) => {
      const staked = Number(data.staked || data.amount || data.principal || 0);
      return (staked / 100000000).toFixed(4);
    }
  }
];