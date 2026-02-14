// src/config/adapters/layerbank.js
// LayerBank - Cross-chain Lending Protocol
// Note: LayerBank might have EVM + Move hybrid architecture

export const layerbankAdapter = [
  {
    id: "layerbank_supply",
    name: "LayerBank Supply",
    type: "Lending",
    
    // Native Move module for LayerBank
    searchString: "::layerbank::", 
    
    parse: (data) => {
      const collateral = Number(
        data.total_collateral || 
        data.deposited || 
        data.supply_balance ||
        data.principal ||
        0
      );
      return (collateral / 100000000).toFixed(4);
    }
  },
  
  {
    id: "layerbank_lending_position",
    name: "LayerBank Deposits",
    type: "Lending",
    
    // Alternative lending module pattern
    searchString: "::lending::",
    
    // Filter specifically for LayerBank
    filterType: (typeString) => {
      return typeString.toLowerCase().includes("layerbank");
    },
    
    parse: (data) => {
      let total = 0;
      
      // Handle array of deposits
      const deposits = data.deposits || data.positions || [];
      if (Array.isArray(deposits)) {
        deposits.forEach(d => {
          total += Number(d.amount || d.value || 0);
        });
      }
      
      // Direct balance
      total += Number(data.balance || data.deposited || 0);
      
      return (total / 100000000).toFixed(4);
    }
  },
  
  {
    id: "layerbank_borrow",
    name: "LayerBank Borrow",
    type: "Debt",
    
    searchString: "::layerbank::",
    
    parse: (data) => {
      const borrowed = Number(
        data.borrowed ||
        data.debt ||
        data.borrow_balance ||
        data.liability ||
        0
      );
      return (borrowed / 100000000).toFixed(4);
    }
  }
];