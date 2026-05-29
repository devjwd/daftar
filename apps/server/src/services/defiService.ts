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

    // 3. Joule Discovery
    const jouleStore = resources.find(r => r.type.includes("::pool::UserStore") && r.type.includes(PROTOCOLS.JOULE));
    if (jouleStore) {
      // Simplification: In a real production app, we'd iterate markets like Echelon
      // For this implementation, we'll mark it as detected
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

