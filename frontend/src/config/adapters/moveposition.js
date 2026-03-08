// src/config/adapters/moveposition.js
// MovePosition Protocol - Lending & Borrowing on Movement Network
// Contract: 0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf
// Supports multiple tokens for lending and borrowing

const MOVEPOSITION_TOKENS = {
  // Core tokens
  MOVE: {
    symbol: "MOVE",
    coinType: "0x1::aptos_coin::AptosCoin",
    decimals: 8,
  },
  // Stablecoins
  USDC: {
    symbol: "USDC",
    coinType: "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39::asset::USDC",
    decimals: 6,
  },
  USDT: {
    symbol: "USDT",
    coinType: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d::asset::USDT",
    decimals: 6,
  },
  USDa: {
    symbol: "USDa",
    coinType: "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650::asset::USDa",
    decimals: 6,
  },
  USDe: {
    symbol: "USDe",
    coinType: "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c::asset::USDe",
    decimals: 6,
  },
  // ETH variants
  WETH: {
    symbol: "WETH",
    coinType: "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376::asset::WETH",
    decimals: 8,
  },
  ezETH: {
    symbol: "ezETH",
    coinType: "0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef::asset::ezETH",
    decimals: 8,
  },
  rsETH: {
    symbol: "rsETH",
    coinType: "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d::asset::rsETH",
    decimals: 8,
  },
  weETH: {
    symbol: "weETH",
    coinType: "0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035::asset::weETH",
    decimals: 8,
  },
  // BTC variants
  WBTC: {
    symbol: "WBTC",
    coinType: "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c::asset::WBTC",
    decimals: 8,
  },
  LBTC: {
    symbol: "LBTC",
    coinType: "0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c::asset::LBTC",
    decimals: 8,
  },
  SolvBTC: {
    symbol: "SolvBTC",
    coinType: "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d::asset::SolvBTC",
    decimals: 8,
  },
  // Other assets
  CAPY: {
    symbol: "CAPY",
    coinType: "0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3::capy::CAPY",
    decimals: 8,
  },
  MOVECAT: {
    symbol: "MOVECAT",
    coinType: "0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a::movecat::MOVECAT",
    decimals: 8,
  },
};

// Create reverse lookup by coinType for faster matching
const COIN_TYPE_TO_TOKEN = {};
Object.entries(MOVEPOSITION_TOKENS).forEach(([, token]) => {
  COIN_TYPE_TO_TOKEN[token.coinType.toLowerCase()] = token;
});

/**
 * Extract symbol from coinType address string
 */
function getSymbolFromCoinType(coinType) {
  // Check direct lookup first
  const normalized = String(coinType).toLowerCase();
  if (COIN_TYPE_TO_TOKEN[normalized]) {
    return COIN_TYPE_TO_TOKEN[normalized].symbol;
  }
  
  // Extract from pattern (0x address::module::type)
  const parts = String(coinType).split("::");
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    // Standard naming often uses uppercase symbols
    return lastPart.toUpperCase();
  }
  
  return null;
}

/**
 * Recursively search for coin amounts in complex data structures
 * MovePosition may store coins in various formats (key-value, nested arrays, etc.)
 */
function extractCoinAmounts(data, visitedObjects = new Set(), depth = 0) {
  if (!data || typeof data !== "object" || depth > 10) return [];
  
  // Prevent infinite recursion
  const dataId = JSON.stringify(data).substring(0, 100);
  if (visitedObjects.has(dataId)) return [];
  visitedObjects.add(dataId);
  
  const coins = [];
  
  // Look for entries that have both a coin identifier and an amount
  for (const [key, value] of Object.entries(data)) {
    const keyLower = String(key).toLowerCase();
    
    // Case 1: Direct coinType as key with amount/value as value
    if (keyLower.includes("::") || keyLower.startsWith("0x")) {
      const symbol = getSymbolFromCoinType(key);
      const amount = Number(value || 0);
      // Accept even tiny amounts (1 = 0.00000001 with 8 decimals)
      if (symbol && amount >= 1) {
        const tokenInfo = MOVEPOSITION_TOKENS[symbol];
        if (tokenInfo) {
          coins.push({
            symbol,
            coinType: key,
            amount,
            decimals: tokenInfo.decimals
          });
        }
      }
    }
    
    // Case 2: Amount stored in object with coinType field
    if (typeof value === "object" && value !== null) {
      const coinType = value.coin_type || value.coinType || value.type;
      const amount = value.amount || value.value || value.balance;
      
      if (coinType && amount !== undefined) {
        const amountNum = Number(amount);
        const symbol = getSymbolFromCoinType(coinType);
        // Accept even tiny amounts
        if (symbol && amountNum >= 1) {
          const tokenInfo = MOVEPOSITION_TOKENS[symbol];
          if (tokenInfo) {
            coins.push({
              symbol,
              coinType,
              amount: amountNum,
              decimals: tokenInfo.decimals
            });
          }
        }
      }
    }
    
    // Case 3: Recursively check nested objects and arrays
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === "object" && item !== null) {
          coins.push(...extractCoinAmounts(item, visitedObjects, depth + 1));
        }
      });
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      coins.push(...extractCoinAmounts(value, visitedObjects, depth + 1));
    }
  }
  
  return coins;
}

/**
 * Log all numeric values found in data for debugging
 */
function logAllNumericValues(data) {
  const values = [];
  try {
    const traverse = (obj, path = "") => {
      if (!obj || typeof obj !== "object" || path.length > 300) return;
      for (const [key, val] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        const num = Number(val);
        if (!isNaN(num) && num > 0 && num < 1000000000000) {
          values.push(`${currentPath}: ${num}`);
        }
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          traverse(val, currentPath);
        } else if (Array.isArray(val)) {
          val.forEach((item, i) => {
            if (typeof item === "object" && item !== null) {
              traverse(item, `${currentPath}[${i}]`);
            } else {
              const num = Number(item);
              if (!isNaN(num) && num > 0 && num < 1000000000000) {
                values.push(`${currentPath}[${i}]: ${num}`);
              }
            }
          });
        }
      }
    };
    traverse(data);
  } catch (e) {
    console.warn("Error logging values:", e);
  }
  if (values.length > 0) {
    console.log("📋 ALL NUMERIC VALUES IN DATA:\n" + values.slice(0, 30).join("\n"));
    if (values.length > 30) console.log(`... and ${values.length - 30} more`);
  }
}

export const movePositionAdapter = [
  {
    id: "moveposition_supply",
    name: "MovePosition Supply",
    type: "Lending",
    protocol: "MovePosition",
    
    // MovePosition uses portfolio module for user positions
    searchString: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::portfolio::",
    
    parse: (data) => {
      try {
        const positions = [];
        
        console.log("🔍 MovePosition Supply - Raw data keys:", Object.keys(data));
        console.log("🔍 Full data structure:", JSON.stringify(data).substring(0, 500));

        // First, try to extract coins from direct coin_type keys or nested structures
        const extractedCoins = extractCoinAmounts(data);
        if (extractedCoins.length > 0) {
          console.log("✅ Found coins via extraction:", extractedCoins.map(c => `${c.symbol}(${c.amount})`).join(", "));
          extractedCoins.forEach(coin => {
            const formatted = coin.amount / Math.pow(10, coin.decimals);
            console.log(`   Adding ${coin.symbol}: ${coin.amount} raw = ${formatted} formatted`);
            positions.push({
              token: coin.symbol,
              symbol: coin.symbol,
              coinType: coin.coinType,
              amount: coin.amount,
              decimals: coin.decimals,
              formattedAmount: formatted.toFixed(6)
            });
          });
        }

        // Also check for supply positions stored by token name in known fields
        const supplyFields = [
          "deposit_notes", "supplied_assets", "supply_positions", 
          "deposit_stores", "supplies", "user_supplies"
        ];
        
        for (const field of supplyFields) {
          const fieldData = data[field];
          if (!fieldData) continue;
          
          console.log(`🔍 Checking field: ${field}`, fieldData);
          
          if (Array.isArray(fieldData)) {
            fieldData.forEach(item => {
              const coins = extractCoinAmounts(item);
              coins.forEach(coin => {
                if (!positions.find(p => p.symbol === coin.symbol)) {
                  const formatted = coin.amount / Math.pow(10, coin.decimals);
                  positions.push({
                    token: coin.symbol,
                    symbol: coin.symbol,
                    coinType: coin.coinType,
                    amount: coin.amount,
                    decimals: coin.decimals,
                    formattedAmount: formatted.toFixed(6)
                  });
                }
              });
            });
          }
        }

        // Check for individual token fields by symbol (case-insensitive)
        for (const [tokenName, tokenInfo] of Object.entries(MOVEPOSITION_TOKENS)) {
          const keyVariants = [
            tokenName,
            tokenName.toLowerCase(),
            `${tokenName}_supply`,
            `${tokenName}_amount`,
            `${tokenName}_balance`,
            `${tokenName}_supplied`,
          ];
          
          for (const key of keyVariants) {
            const amount = Number(data[key] || 0);
            // Accept even 1 unit (0.00000001 for 8 decimals)
            if (amount >= 1) {
              if (!positions.find(p => p.symbol === tokenName)) {
                const formatted = amount / Math.pow(10, tokenInfo.decimals);
                console.log(`✅ Found ${tokenName} supply: ${amount} = ${formatted}`);
                positions.push({
                  token: tokenName,
                  symbol: tokenName,
                  coinType: tokenInfo.coinType,
                  amount: amount,
                  decimals: tokenInfo.decimals,
                  formattedAmount: formatted.toFixed(6)
                });
              }
              break;
            }
          }
        }

        console.log("📊 Final supply positions found:", positions.map(p => `${p.symbol}:${p.formattedAmount}`).join(", "));
        return positions.length > 0 ? positions : "0";
      } catch (e) {
        console.warn("Error parsing MovePosition supply:", e);
        return "0";
      }
    }
  },

  {
    id: "moveposition_borrow",
    name: "MovePosition Borrow",
    type: "Debt",
    protocol: "MovePosition",
    
    searchString: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::portfolio::",
    
    parse: (data) => {
      try {
        const positions = [];
        
        console.log("🔍 MovePosition Borrow - Raw data keys:", Object.keys(data));
        console.log("🔍 Full data structure:", JSON.stringify(data).substring(0, 500));
        logAllNumericValues(data, "borrow");
        logAllNumericValues(data, "supply");

        // First, try to extract coins from direct coin_type keys or nested structures
        const extractedCoins = extractCoinAmounts(data);
        if (extractedCoins.length > 0) {
          console.log("✅ Found coins via extraction:", extractedCoins.map(c => `${c.symbol}(${c.amount})`).join(", "));
          extractedCoins.forEach(coin => {
            const formatted = coin.amount / Math.pow(10, coin.decimals);
            console.log(`   Adding ${coin.symbol}: ${coin.amount} raw = ${formatted} formatted`);
            positions.push({
              token: coin.symbol,
              symbol: coin.symbol,
              coinType: coin.coinType,
              amount: coin.amount,
              decimals: coin.decimals,
              formattedAmount: formatted.toFixed(6),
              interestAccumulated: 0
            });
          });
        }

        // Also check for borrow positions stored by token name in known fields
        const borrowFields = [
          "loan_notes", "borrowed_assets", "borrow_positions", 
          "loan_stores", "borrows", "user_borrows", "debts"
        ];
        
        for (const field of borrowFields) {
          const fieldData = data[field];
          if (!fieldData) continue;
          
          console.log(`🔍 Checking field: ${field}`, fieldData);
          
          if (Array.isArray(fieldData)) {
            fieldData.forEach(item => {
              const coins = extractCoinAmounts(item);
              coins.forEach(coin => {
                if (!positions.find(p => p.symbol === coin.symbol)) {
                  const formatted = coin.amount / Math.pow(10, coin.decimals);
                  positions.push({
                    token: coin.symbol,
                    symbol: coin.symbol,
                    coinType: coin.coinType,
                    amount: coin.amount,
                    decimals: coin.decimals,
                    formattedAmount: formatted.toFixed(6),
                    interestAccumulated: 0
                  });
                }
              });
            });
          }
        }

        // Check for individual token fields by symbol (case-insensitive)
        for (const [tokenName, tokenInfo] of Object.entries(MOVEPOSITION_TOKENS)) {
          const keyVariants = [
            tokenName,
            tokenName.toLowerCase(),
            `${tokenName}_borrow`,
            `${tokenName}_debt`,
            `${tokenName}_amount`,
            `${tokenName}_balance`,
            `${tokenName}_borrowed`,
          ];
          
          for (const key of keyVariants) {
            const amount = Number(data[key] || 0);
            // Accept even 1 unit (0.00000001 for 8 decimals)
            if (amount >= 1) {
              if (!positions.find(p => p.symbol === tokenName)) {
                const formatted = amount / Math.pow(10, tokenInfo.decimals);
                console.log(`✅ Found ${tokenName} borrow: ${amount} = ${formatted}`);
                positions.push({
                  token: tokenName,
                  symbol: tokenName,
                  coinType: tokenInfo.coinType,
                  amount: amount,
                  decimals: tokenInfo.decimals,
                  formattedAmount: formatted.toFixed(6),
                  interestAccumulated: 0
                });
              }
              break;
            }
          }
        }

        console.log("📊 Final borrow positions found:", positions.map(p => `${p.symbol}:${p.formattedAmount}`).join(", "));
        return positions.length > 0 ? positions : "0";
      } catch (e) {
        console.warn("Error parsing MovePosition borrow:", e);
        return "0";
      }
    }
  }
];