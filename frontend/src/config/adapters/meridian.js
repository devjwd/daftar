// src/config/adapters/meridian.js
// Meridian - CDP & Stablecoin Protocol on Movement Network
// Website: https://app.meridian.money/
// Contract: 0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82

export const meridianAdapter = [
  // CDP / Vault Positions
  {
    id: "meridian_vault",
    name: "Meridian Vault",
    type: "Lending",
    
    // Vault/Trove positions store collateral and debt
    searchString: "::vault::", 

    parse: (data) => {
      let collateral = 0;
      
      // Try different field names for collateral
      if (data.collateral) {
        collateral = Number(data.collateral.value || data.collateral);
      } else if (data.collateral_amount) {
        collateral = Number(data.collateral_amount);
      } else if (data.deposited) {
        collateral = Number(data.deposited);
      } else if (data.locked_amount) {
        collateral = Number(data.locked_amount);
      }

      return (collateral / 100000000).toFixed(4);
    }
  },
  
  // CDP Debt (Minted stablecoins)
  {
    id: "meridian_debt",
    name: "Meridian Debt",
    type: "Debt",
    
    searchString: "::vault::",
    
    parse: (data) => {
      let debt = 0;
      
      // Try different field names for debt
      if (data.debt) {
        debt = Number(data.debt.value || data.debt);
      } else if (data.debt_amount) {
        debt = Number(data.debt_amount);
      } else if (data.minted) {
        debt = Number(data.minted);
      } else if (data.borrowed) {
        debt = Number(data.borrowed);
      }
      
      return (debt / 100000000).toFixed(4);
    }
  },

  // AMM Liquidity Positions
  {
    id: "meridian_lp",
    name: "Meridian LP",
    type: "Liquidity",
    
    searchString: "::swap::LPCoin", 
    
    parse: (data) => {
      const balance = Number(data.coin?.value || data.value || 0);
      return (balance / 1000000).toFixed(4);
    }
  },
  
  // Stability Pool Deposits
  {
    id: "meridian_stability",
    name: "Meridian Stability Pool",
    type: "Staking",
    
    searchString: "::stability_pool::",
    
    parse: (data) => {
      const deposited = Number(data.deposited || data.amount || data.stake || 0);
      return (deposited / 100000000).toFixed(4);
    }
  }
];