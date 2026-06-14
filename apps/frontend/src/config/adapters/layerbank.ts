// src/config/adapters/layerbank.js
// LayerBank - Cross-chain Lending Protocol
// Note: LayerBank might have EVM + Move hybrid architecture
import { resolveTokenPrice } from "../../utils/price";

export const layerbankAdapter = [
  {
    id: "layerbank_supply",
    name: "LayerBank Supply",
    type: "Lending",
    
    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const { getUserTokenBalances } = await import('../../services/indexer');
      const balances = await getUserTokenBalances(targetAddress);
      
      const lbBalances = balances.filter(b => {
        const symbol = (b.metadata?.symbol || b.symbol || '');
        const type = String(b.asset_type || '').toLowerCase();
        
        // Protocol-specific keywords are the strongest signal
        const isProtocolType = type.includes('layerbank') || type.includes('supply_logic');
        
        // Receipt tokens usually follow specific patterns
        // e.g., lMOVE, lUSDC, lbMOVE, etc.
        // We check for 'l' or 'lb' prefix followed by an uppercase letter (the underlying asset)
        const isReceiptToken = /^(l|lb)[A-Z]/.test(symbol);

        return isProtocolType || isReceiptToken;
      });

      const positions = lbBalances.map(b => {
        const decimals = b.metadata?.decimals || 8;
        const amount = b.numericAmount !== undefined ? b.numericAmount : (Number(String(b.rawAmount || b.amount || 0).replace(/,/g, '')) / Math.pow(10, decimals));
        let symbol = (b.metadata?.symbol || "LB").replace(/^u/, '');
        
        // Clean up receipt prefixes (e.g. lMOVE -> MOVE, lUSDC.e -> USDC.e)
        if (/^l[A-Z]/.test(symbol)) {
          symbol = symbol.slice(1);
        } else if (/^lb[A-Z]/.test(symbol)) {
          symbol = symbol.slice(2);
        }

        const price = resolveTokenPrice(priceMap, b.asset_type, symbol);
        const usdValue = amount * price;

        return {
          id: `layerbank_balance_${b.asset_type}`,
          name: "LayerBank Supply",
          type: "Lending",
          tokenSymbol: symbol,
          numericValue: usdValue,
          value: amount.toFixed(4),
          protocol: "layerbank",
          protocolName: "LayerBank",
          protocolWebsite: "https://layerbank.finance",
          usdValue: usdValue,
          amount: amount
        };
      });

      // Also check resources
      const lbResources = resources.filter(r => 
        r.type.includes("::layerbank::") || 
        r.type.includes("::token_base::") || 
        r.type.includes("::supply_logic::")
      );
      lbResources.forEach((r, idx) => {
          const collateral = Number(r.data.total_collateral || r.data.deposited || r.data.balance || 0);
          if (collateral > 0) {
              positions.push({
                  id: `layerbank_res_${idx}`,
                  name: "LayerBank Position",
                  type: "Lending",
                  tokenSymbol: "LB",
                  numericValue: collateral / 1e8,
                  value: (collateral / 1e8).toFixed(4),
                  protocol: "layerbank",
                  protocolName: "LayerBank",
                  protocolWebsite: "https://layerbank.finance",
                  usdValue: collateral / 1e8,
                  amount: collateral / 1e8
              });
          }
      });

      return positions;
    },
  },
  
  // Removed redundant LayerBank Deposits adapter - consolidated into discover logic above
  
  {
    id: "layerbank_borrow",
    name: "LayerBank Borrow",
    type: "Debt",
    
    discover: async ({ client, targetAddress, resources, priceMap }) => {
      const lbResources = resources.filter(r => 
        r.type.includes("::layerbank::") || 
        r.type.includes("::token_base::") || 
        r.type.includes("::supply_logic::")
      );
      
      const positions = [];
      lbResources.forEach((r, idx) => {
          const debt = Number(r.data.borrowed || r.data.debt || r.data.liability || 0);
          if (debt > 0) {
              positions.push({
                  id: `layerbank_debt_${idx}`,
                  name: "LayerBank Borrow",
                  type: "Debt",
                  tokenSymbol: "LB",
                  numericValue: debt / 1e8,
                  value: (debt / 1e8).toFixed(4),
                  protocol: "layerbank",
                  protocolName: "LayerBank",
                  protocolWebsite: "https://layerbank.finance"
              });
          }
      });
      return positions;
    }
  }
];
