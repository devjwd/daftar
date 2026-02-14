// src/config/adapters/echelon.js
// Echelon Finance - Leading Lending Protocol on Movement Network
// Website: https://echelon.finance
// Contract: 0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5

export const echelonAdapter = [
  // ---------------------------------------------------------
  // LENDING SUPPLY POSITIONS
  // ---------------------------------------------------------
  {
    id: "echelon_supply",
    name: "Echelon Supply",
    type: "Lending",
    
    // Echelon stores user lending data in UserAccount resource
    searchString: "::lending::UserAccount", 

    parse: (data) => {
      let totalRaw = 0;

      // Echelon stores assets in collateral map
      const collateralList = data.collateral?.data || data.deposits?.data || [];
      const supplyList = data.supply_positions?.data || [];

      // Parse collateral positions
      if (Array.isArray(collateralList)) {
        collateralList.forEach(item => {
          const val = item.value?.amount || item.value?.value || item.amount || 0;
          totalRaw += Number(val);
        });
      }

      // Parse supply positions
      if (Array.isArray(supplyList)) {
        supplyList.forEach(item => {
          const val = item.value?.amount || item.value?.value || item.amount || 0;
          totalRaw += Number(val);
        });
      }

      // Convert from 8 decimals (Movement standard)
      return (totalRaw / 100000000).toFixed(4);
    }
  },
  
  // ---------------------------------------------------------
  // RECEIPT TOKENS (ecTokens like ecUSDC, ecMOVE)
  // ---------------------------------------------------------
  {
    id: "echelon_receipt_tokens",
    name: "Echelon Deposits",
    type: "Lending",
    
    searchString: "0x1::coin::CoinStore",
    
    // Filter for Echelon's receipt token prefix
    filterType: (typeString) => {
      return typeString.includes("echelon") || 
             typeString.includes("::ec") ||
             typeString.includes("EchelonCoin");
    },

    parse: (data) => {
      const balance = Number(data.coin?.value || data.value || 0);
      return (balance / 100000000).toFixed(4);
    }
  },

  // ---------------------------------------------------------
  // BORROW POSITIONS (Debt)
  // ---------------------------------------------------------
  {
    id: "echelon_borrow",
    name: "Echelon Borrow",
    type: "Debt",
    searchString: "::lending::UserAccount",
    
    parse: (data) => {
      let totalDebt = 0;
      
      // Parse borrow positions
      const borrowList = data.borrows?.data || data.liabilities?.data || data.borrow_positions?.data || [];

      if (Array.isArray(borrowList)) {
        borrowList.forEach(item => {
          const val = item.value?.amount || item.value?.value || item.amount || 0;
          totalDebt += Number(val);
        });
      }

      return (totalDebt / 100000000).toFixed(4);
    }
  }
];