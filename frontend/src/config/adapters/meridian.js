// src/config/adapters/meridian.js
// Meridian - CDP & Stablecoin Protocol on Movement Network
// Website: https://app.meridian.money/
// Contract: 0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82

const toPositiveNumber = (value) => {
  if (value === null || value === undefined) return 0;

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  if (typeof value === "string") {
    if (!/^\d+(\.\d+)?$/.test(value)) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  if (typeof value === "object") {
    if (value.value !== undefined) return toPositiveNumber(value.value);
    if (value.amount !== undefined) return toPositiveNumber(value.amount);
    if (value.coin !== undefined) return toPositiveNumber(value.coin);
  }

  return 0;
};

const collectFields = (node, fieldNames, maxDepth = 8, depth = 0) => {
  if (!node || depth > maxDepth) return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectFields(item, fieldNames, maxDepth, depth + 1));
  }

  if (typeof node !== "object") {
    return [];
  }

  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (fieldNames.has(key)) {
      const numeric = toPositiveNumber(value);
      if (numeric > 0) {
        found.push(numeric);
      }
    }

    if (value && typeof value === "object") {
      found.push(...collectFields(value, fieldNames, maxDepth, depth + 1));
    }
  }

  return found;
};

const sumFields = (data, fields) => {
  const values = collectFields(data, new Set(fields));
  if (!values.length) return 0;
  return values.reduce((sum, current) => sum + current, 0);
};

const pickLargestField = (data, fields) => {
  const values = collectFields(data, new Set(fields));
  if (!values.length) return 0;
  return Math.max(...values);
};

const formatByLikelyDecimals = (rawValue, preferredDecimals = [6, 8]) => {
  if (!rawValue || rawValue <= 0) return "0";

  for (const decimals of preferredDecimals) {
    const normalized = rawValue / Math.pow(10, decimals);
    if (normalized >= 0.0001 && normalized < 1_000_000_000) {
      return normalized.toFixed(4);
    }
  }

  return rawValue.toFixed(4);
};

export const meridianAdapter = [
  // Generic Meridian Position/Pool Detection - Catches any Meridian swap resource
  {
    id: "meridian_generic",
    name: "Meridian LP",
    type: "Liquidity",
    
    // Match ANY Meridian swap module resource
    searchString: "0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82::swap::",
    
    parse: (data) => {
      let totalValue = 0;
      let tokenXAmount = 0;
      let tokenYAmount = 0;
      
      tokenXAmount = sumFields(data, ["coin_x_amount", "liquidity_x", "token_x_amount", "x_amount"]);
      tokenYAmount = sumFields(data, ["coin_y_amount", "liquidity_y", "token_y_amount", "y_amount"]);
      
      // Try all possible position fields
      const fieldsToTry = [
        "liquidity", "amount", "shares", "value", "balance",
        "total_value", "position_value", "lp_amount", "staked", "staked_amount"
      ];
      
      totalValue = pickLargestField(data, fieldsToTry);
      
      // If no direct field found, check nested structures
      if (totalValue === 0) {
        const findValue = (obj, depth = 0) => {
          if (depth > 3) return 0;
          if (typeof obj === "number" || (typeof obj === "string" && /^\d+$/.test(obj))) {
            const num = Number(obj);
            return num > 0 ? num : 0;
          }
          if (typeof obj === "object" && obj !== null) {
            for (const field of fieldsToTry) {
              if (obj[field] !== undefined) {
                const val = findValue(obj[field], depth + 1);
                if (val > 0) return val;
              }
            }
            for (const key in obj) {
              const val = findValue(obj[key], depth + 1);
              if (val > 0) return val;
            }
          }
          return 0;
        };
        totalValue = findValue(data);
      }

      if (totalValue === 0) {
        totalValue = tokenXAmount + tokenYAmount;
      }
      
      return formatByLikelyDecimals(totalValue, [6, 8]);
    }
  },

  // User Pools Map - Stores user's LP positions
  {
    id: "meridian_userpools",
    name: "Meridian Pools",
    type: "Liquidity",
    
    searchString: "UserPoolsMap",
    
    parse: (data) => {
      const totalLiquidity = sumFields(data, [
        "liquidity", "amount", "value", "shares", "lp_amount", "coin_x_amount", "coin_y_amount"
      ]);

      return formatByLikelyDecimals(totalLiquidity, [6, 8]);
    }
  },

  // User Positions Map - Individual LP position data with token breakdown
  {
    id: "meridian_userpositions",
    name: "Meridian Positions",
    type: "Liquidity",
    
    searchString: "UserPositionsMap",
    
    parse: (data) => {
      const tokenXTotal = sumFields(data, ["liquidity_x", "coin_x_amount", "token_x_amount", "x_amount"]);
      const tokenYTotal = sumFields(data, ["liquidity_y", "coin_y_amount", "token_y_amount", "y_amount"]);

      let totalValue = sumFields(data, ["liquidity", "amount", "shares", "value", "lp_amount"]);
      if (!totalValue) {
        totalValue = tokenXTotal + tokenYTotal;
      }

      return formatByLikelyDecimals(totalValue, [6, 8]);
    }
  },

  // User Position in Swap Pool - stores actual LP holdings with composition
  {
    id: "meridian_position",
    name: "Meridian Position",
    type: "Liquidity",
    
    searchString: "::ds::",
    
    parse: (data) => {
      let balance = pickLargestField(data, ["liquidity", "amount", "shares", "value", "lp_amount"]);
      let tokenXAmount = sumFields(data, ["liquidity_x", "coin_x_amount", "token_x_amount", "x_amount"]);
      let tokenYAmount = sumFields(data, ["liquidity_y", "coin_y_amount", "token_y_amount", "y_amount"]);

      if (!balance) {
        balance = tokenXAmount + tokenYAmount;
      }
      
      return formatByLikelyDecimals(balance, [6, 8]);
    }
  },

  // CDP / Vault Positions
  {
    id: "meridian_vault",
    name: "Meridian Vault",
    type: "Lending",
    
    searchString: "::vault::", 

    parse: (data) => {
      let collateral = 0;
      
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
      
      if (data.debt) {
        debt = Number(data.debt.value || data.debt);
      } else if (data.debt_amount) {
        debt = Number(data.debt_amount);
      } else if (data.minted) {
        debt = Number(data.minted);
      } else if (data.borrowed) {
        debt = Number(data.borrowed);
      }
      
      return formatByLikelyDecimals(debt, [8, 6]);
    }
  },

  // AMM Liquidity Positions - CoinStore<LPCoin>
  {
    id: "meridian_lp",
    name: "Meridian LP Token",
    type: "Liquidity",
    
    searchString: "::swap::LPCoin", 
    
    parse: (data) => {
      const balance = pickLargestField(data, ["value", "amount", "coin", "balance", "liquidity", "shares"]);
      return formatByLikelyDecimals(balance, [6, 8]);
    }
  },

  // Stability Pool Deposits
  {
    id: "meridian_stability",
    name: "Meridian Stability Pool",
    type: "Staking",
    
    searchString: "::stability_pool::",
    
    parse: (data) => {
      const deposited = sumFields(data, ["deposited", "amount", "stake", "staked", "staked_amount", "deposit"]);
      return formatByLikelyDecimals(deposited, [8, 6]);
    }
  },

  // Staking - MERL token staking (LP staking)
  {
    id: "meridian_staking",
    name: "Meridian Staked LP",
    type: "Farming",
    
    searchString: "::staking::",
    
    parse: (data) => {
      const staked = sumFields(data, ["amount", "staked", "staked_amount", "deposit", "deposited", "stake", "lp_amount"]);
      return formatByLikelyDecimals(staked, [6, 8]);
    }
  }
];