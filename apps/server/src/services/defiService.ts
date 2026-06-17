import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import CONFIG from "../config/index.ts";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side DeFi Discovery Service
 * Scans Movement Network for protocol positions (Lending, LP, Staking)
 */

export interface DeFiPosition {
  protocol: string;
  type: string;
  amount: number;
  usdValue: number;
  symbol: string;
}

// Protocol Contracts
const PROTOCOLS = {
  ECHELON: "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5",
  JOULE: "0x6a1641074e644917a10a6889b43d2c884631338870ed227575dfa312384f507b",
  MOVEPOSITION: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf",
  MERIDIAN: "0x8f396e838e12d6a5f97334460f1b40280b271d507119e7116790d96d740c493c"
};

const aptosConfig = new AptosConfig({
  fullnode: CONFIG.MOVEMENT.RPC_URL,
});
const client = new Aptos(aptosConfig);

/**
 * Fetches all DeFi positions for a wallet
 */
export async function fetchUserDeFiPositions(
  supabase: SupabaseClient,
  walletAddress: string,
  priceMap: Record<string, number>
): Promise<DeFiPosition[]> {
  const positions: DeFiPosition[] = [];

  try {
    // 1. Fetch Account Resources
    const resources = await client.getAccountResources({ accountAddress: walletAddress });
    
    // 2. Discover Echelon Positions
    const echelonVault = resources.find(r => r.type.includes("::lending::Vault") && r.type.includes(PROTOCOLS.ECHELON));
    if (echelonVault) {
      const data = echelonVault.data as any;
      const collaterals = data.collaterals?.data || [];
      const liabilities = data.liabilities?.data || [];

      // Process Collaterals (Lending)
      for (const c of collaterals) {
        const market = c.key?.inner;
        if (!market || Number(c.value) <= 0) continue;
        
        try {
          const [nameRes, coinsRes] = await Promise.all([
            client.view({ payload: { function: `${PROTOCOLS.ECHELON}::lending::market_asset_name`, functionArguments: [market] } }),
            client.view({ payload: { function: `${PROTOCOLS.ECHELON}::lending::account_coins`, functionArguments: [walletAddress, market] } })
          ]);

          const symbol = String(nameRes[0] || "").split('::').pop()?.replace('Coin', '') || "MOVE";
          const amount = Number(coinsRes[0]) / Math.pow(10, 8); // Echelon normalizes collateral to 8 decimals
          
          // Try to find price by market address or symbol
          const price = priceMap[market] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;

          if (amount > 0.0001) {
            positions.push({
              protocol: "Echelon",
              type: "Lending",
              amount,
              usdValue: amount * price,
              symbol
            });
          }
        } catch (e) {}
      }

      // Process Liabilities (Debt/Borrows)
      for (const l of liabilities) {
        const market = l.key?.inner;
        if (!market || Number(l.value?.principal) <= 0) continue;

        try {
          const [nameRes, debtRes] = await Promise.all([
            client.view({ payload: { function: `${PROTOCOLS.ECHELON}::lending::market_asset_name`, functionArguments: [market] } }),
            client.view({ payload: { function: `${PROTOCOLS.ECHELON}::lending::account_liability`, functionArguments: [walletAddress, market] } })
          ]);

          const symbol = String(nameRes[0] || "").split('::').pop()?.replace('Coin', '') || "MOVE";
          const amount = Number(debtRes[0]) / Math.pow(10, 8); // Echelon normalizes liabilities to 8 decimals

          // Try to find price by market address or symbol
          const price = priceMap[market] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;

          if (amount > 0.0001) {
            positions.push({
              protocol: "Echelon",
              type: "Debt",
              amount,
              usdValue: -amount * price, // Negative USD value for networth subtraction
              symbol
            });
          }
        } catch (e) {}
      }
    }

    // MovePosition Discovery
    const movePositionPortfolio = resources.find(r => r.type.includes("::portfolio::Portfolio") && r.type.includes(PROTOCOLS.MOVEPOSITION));
    if (movePositionPortfolio) {
      const data = movePositionPortfolio.data as any;
      
      const decodeMPHex = (hexString: string) => {
        if (!hexString || !hexString.startsWith("0x")) return null;
        const hex = hexString.slice(2);
        let decoded = "";
        for (let i = 0; i < hex.length; i += 2) decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        const match = decoded.match(/::coins::(\w+)>/);
        return match ? match[1] : null;
      };

      const collateralsItems = data.collaterals?.items || [];
      const collateralsKeys = data.collaterals?.keys?.items || [];
      for (let idx = 0; idx < collateralsKeys.length; idx++) {
        const key = collateralsKeys[idx];
        const notes = collateralsItems[idx];
        if (!notes || Number(notes) <= 0) continue;

        const rawSymbol = decodeMPHex(key?.struct_name || "");
        if (rawSymbol) {
          const symbol = rawSymbol === "USDC" ? "USDC.e" : rawSymbol === "USDT" ? "USDT.e" : rawSymbol === "WETH" ? "WETH.e" : rawSymbol === "WBTC" ? "WBTC.e" : rawSymbol;
          const coinType = `${PROTOCOLS.MOVEPOSITION}::coins::${rawSymbol}`;
          try {
            const result = await client.view({ payload: { function: `${PROTOCOLS.MOVEPOSITION}::broker::calc_coins_from_dnotes`, functionArguments: [notes], typeArguments: [coinType] } });
            const amountRaw = Number(result[0]);
            const decimals = (symbol === "USDC.e" || symbol === "USDT.e") ? 6 : 8;
            const amount = amountRaw / Math.pow(10, decimals);
            const price = priceMap[coinType] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;
            if (amount > 0.0001) positions.push({ protocol: "MovePosition", type: "Lending", amount, usdValue: amount * price, symbol });
          } catch(e) {}
        }
      }

      const liabilityItems = data.liabilities?.items || [];
      const liabilityKeys = data.liabilities?.keys?.items || [];
      for (let idx = 0; idx < liabilityKeys.length; idx++) {
        const key = liabilityKeys[idx];
        const notes = liabilityItems[idx];
        if (!notes || Number(notes) <= 0) continue;

        const rawSymbol = decodeMPHex(key?.struct_name || "");
        if (rawSymbol) {
          const symbol = rawSymbol === "USDC" ? "USDC.e" : rawSymbol === "USDT" ? "USDT.e" : rawSymbol === "WETH" ? "WETH.e" : rawSymbol === "WBTC" ? "WBTC.e" : rawSymbol;
          const coinType = `${PROTOCOLS.MOVEPOSITION}::coins::${rawSymbol}`;
          try {
            const result = await client.view({ payload: { function: `${PROTOCOLS.MOVEPOSITION}::broker::calc_coins_from_lnotes`, functionArguments: [notes], typeArguments: [coinType] } });
            const amountRaw = Number(result[0]);
            const decimals = (symbol === "USDC.e" || symbol === "USDT.e") ? 6 : 8;
            const amount = amountRaw / Math.pow(10, decimals);
            const price = priceMap[coinType] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;
            if (amount > 0.0001) positions.push({ protocol: "MovePosition", type: "Debt", amount, usdValue: -amount * price, symbol });
          } catch(e) {}
        }
      }
    }

    // 3. Joule Discovery
    const joulePositionsMap = resources.find(r => r.type.includes("::pool::UserPositionsMap") && r.type.includes(PROTOCOLS.JOULE));
    if (joulePositionsMap) {
      const data = joulePositionsMap.data as any;
      const positionsMap = data.positions_map?.data || [];

      for (const pos of positionsMap) {
        // Process Lend Positions
        const lendPositions = pos.value?.lend_positions?.data || [];
        for (const lp of lendPositions) {
          const coinType = lp.key;
          const amountRaw = Number(lp.value || 0);
          if (amountRaw > 0) {
            const parts = coinType.split("::");
            const rawSymbol = parts[parts.length - 1] || "Unknown";
            const symbol = rawSymbol === "AptosCoin" ? "MOVE" : rawSymbol;
            const amount = amountRaw / 1e8;
            const price = priceMap[coinType] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;

            if (amount > 0.0001) {
              positions.push({
                protocol: "Joule",
                type: "Lending",
                amount,
                usdValue: amount * price,
                symbol
              });
            }
          }
        }

        // Process Borrow Positions
        const borrowPositions = pos.value?.borrow_positions?.data || [];
        for (const bp of borrowPositions) {
          const coinType = bp.key;
          const amountRaw = Number(bp.value?.borrow_amount || 0);
          if (amountRaw > 0) {
            const parts = coinType.split("::");
            const rawSymbol = parts[parts.length - 1] || "Unknown";
            const symbol = rawSymbol === "AptosCoin" ? "MOVE" : rawSymbol;
            const amount = amountRaw / 1e8;
            const price = priceMap[coinType] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;

            if (amount > 0.0001) {
              positions.push({
                protocol: "Joule",
                type: "Debt",
                amount,
                usdValue: -amount * price,
                symbol
              });
            }
          }
        }
      }
    }

    // Joule Staking/Rewards Discovery
    const jouleUserPoolsMap = resources.find(r => r.type.includes("::rewards::UserPoolsMap") && r.type.includes(PROTOCOLS.JOULE));
    if (jouleUserPoolsMap) {
      const data = jouleUserPoolsMap.data as any;
      const poolsMap = data.user_pools_map?.data || [];

      for (const pool of poolsMap) {
        const stakeAmount = Number(pool.value?.stake_amount || 0);
        if (stakeAmount > 0) {
          const coinName = pool.value?.coin_name || pool.key;
          const parts = coinName.split("::");
          let rawSymbol = parts[parts.length - 1] || "Unknown";
          rawSymbol = rawSymbol.replace(/\d+$/, ''); 
          const symbol = rawSymbol === "AptosCoin" ? "MOVE" : rawSymbol;
          const amount = stakeAmount / 1e8;
          const price = priceMap[coinName] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || priceMap['0x1'] || 0;

          if (amount > 0.0001) {
            positions.push({
              protocol: "Joule",
              type: "Staking",
              amount,
              usdValue: amount * price,
              symbol
            });
          }
        }
      }
    }

    // 4. Canopy Staking Discovery
    try {
      const canopyVaultsRes = await client.view({
        payload: {
          function: `0xb10bd32b3979c9d04272c769d9ef52afbc6edc4bf03982a9e326b96ac25e7f2d::satay::vaults_view`,
          typeArguments: [],
          functionArguments: []
        }
      });

      if (canopyVaultsRes && Array.isArray(canopyVaultsRes[0])) {
        const vaultAddresses = canopyVaultsRes[0].map((v: any) => typeof v === 'object' && v?.inner ? v.inner : String(v));
        
        for (const vaultAddr of vaultAddresses) {
          try {
            const stakedBalanceRes = await client.view({
              payload: {
                function: `0x113a1769acc5ce21b5ece6f9533eef6dd34c758911fa5235124c87ff1298633b::multi_rewards::get_user_staked_balance`,
                typeArguments: [],
                functionArguments: [walletAddress, vaultAddr]
              }
            });

            const rawBalance = Number(stakedBalanceRes[0] || 0);
            if (rawBalance > 0) {
              const [symbolRes, decimalsRes] = await Promise.all([
                client.view({
                  payload: {
                    function: "0x1::fungible_asset::symbol",
                    typeArguments: [],
                    functionArguments: [vaultAddr]
                  }
                }).catch(() => null),
                client.view({
                  payload: {
                    function: "0x1::fungible_asset::decimals",
                    typeArguments: [],
                    functionArguments: [vaultAddr]
                  }
                }).catch(() => null)
              ]);

              const symbol = String(symbolRes?.[0] || "cvMOVE");
              const decimals = Number(decimalsRes?.[0] || 8);
              const amount = rawBalance / Math.pow(10, decimals);

              // Resolve price
              let price = priceMap[vaultAddr] || priceMap[Object.keys(priceMap).find(k => k.includes(symbol.toLowerCase())) || ''] || 0;
              if (price === 0) {
                const upperSym = symbol.toUpperCase();
                if (upperSym.includes("MOVE")) {
                  price = priceMap['0x1'] || priceMap['0xa'] || 0.01806;
                } else if (upperSym.includes("BTC")) {
                  price = priceMap['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'] || 81096.63;
                } else if (upperSym.includes("ETH")) {
                  price = priceMap['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'] || 2331.60;
                } else {
                  price = priceMap['0x1'] || 0;
                }
              }

              if (amount > 0.0001) {
                positions.push({
                  protocol: "Canopy",
                  type: "Staking",
                  amount,
                  usdValue: amount * price,
                  symbol
                });
              }
            }
          } catch (vaultErr) {
            console.error(`[DeFiService] Canopy: Error fetching staked balance for vault ${vaultAddr}:`, vaultErr);
          }
        }
      }
    } catch (canopyErr) {
      console.error("[DeFiService] Canopy: Error querying vaults list:", canopyErr);
    }

  } catch (err) {
    console.error(`[DeFiService] Error scanning ${walletAddress}:`, err);
  }

  return positions;
}

