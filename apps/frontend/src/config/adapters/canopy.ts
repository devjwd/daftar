// src/config/adapters/canopy.ts
// Canopy Finance - Liquid Staking & DeFi on Movement Network
// Website: https://app.canopyhub.xyz/
import { resolveTokenPrice } from "../../utils/price";
import { CANOPY_CONFIG } from "../network";
import { getUserTokenBalances } from "../../services/indexer";
import { devLog } from "../../utils/devLogger";

export const canopyAdapter = [
  {
    id: "canopy_finance",
    name: "Canopy Finance",
    type: "Liquidity",
    searchString: "::vault::", // Participate in resource-based discovery

    discover: async ({ client, targetAddress, resources, balances, priceMap }) => {
      try {
        // If balances weren't passed or are empty, fetch them from indexer
        const allBalances = (balances && balances.length > 0) ? balances : await getUserTokenBalances(targetAddress);
        devLog(`Canopy: Processing ${allBalances?.length || 0} balances`);

        // 1. FA-Based Detection
        const canopyPositions = (allBalances || []).filter(b => {
          const symbol = (b.metadata?.symbol || b.symbol || '').trim().toUpperCase();
          const type = String(b.asset_type || '').toLowerCase();

          // stMOVE, stETH, CNP, CNP-LP, cvMOVE, etc.
          const isCanopy = 
            symbol === 'STMOVE' ||
            symbol === 'STETH' ||
            symbol === 'CNP' ||
            symbol.includes('CNP-LP') ||
            symbol.startsWith('CV') ||
            type.includes('canopy') ||
            (CANOPY_CONFIG.coreVaultsAddress && type.includes(CANOPY_CONFIG.coreVaultsAddress.toLowerCase()));
          
          return isCanopy;
        });
        devLog(`Canopy: Found ${canopyPositions.length} positions in balances`);

        const processedVaults = new Set<string>();
        const positions = (await Promise.all((canopyPositions || []).map(async (b) => {
          const symbol = (b.metadata?.symbol || b.symbol || 'stMOVE').trim();
          const decimals = b.metadata?.decimals || 8;
          let amount = Number(b.amount || 0) / Math.pow(10, decimals);

          if (b.asset_type) {
            processedVaults.add(b.asset_type.toLowerCase());
          }

          // Query staked balance for this token
          let stakedError = "";
          if (client && b.asset_type && CANOPY_CONFIG.rewardsAddress) {
            try {
              const stakedBalanceRes = await client.view({
                payload: {
                  function: `${CANOPY_CONFIG.rewardsAddress}::multi_rewards::get_user_staked_balance`,
                  typeArguments: [],
                  functionArguments: [targetAddress, b.asset_type]
                }
              });
              const rawStaked = Number(stakedBalanceRes[0] || 0);
              if (rawStaked > 0) {
                const stakedAmount = rawStaked / Math.pow(10, decimals);
                amount += stakedAmount;
                devLog(`Canopy: Found staked balance of ${stakedAmount} for ${symbol}`);
              } else {
                stakedError = "rawStaked = 0";
              }
            } catch (err: any) {
              devLog(`Canopy: Failed to query staked balance for ${symbol}:`, err);
              stakedError = String(err.message || err);
            }
          } else {
            stakedError = `no client/type/rewards. type=${b.asset_type?.slice(0, 10)}`;
          }

          // Price logic using shared utility
          const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
          const ethPrice = resolveTokenPrice(priceMap, '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376', 'ETH');

          let usdValue = 0;
          if (symbol.toUpperCase().includes('MOVE')) usdValue = amount * movePrice;
          else if (symbol.toUpperCase().includes('ETH')) usdValue = amount * ethPrice;
          else usdValue = amount * resolveTokenPrice(priceMap, b.asset_type, symbol);

          const debugName = stakedError 
            ? `ERR: ${stakedError.slice(0, 30)} (type: ${b.asset_type?.slice(0, 8)})`
            : (symbol.toLowerCase().startsWith('st') ? `Canopy Liquid ${symbol.slice(2)}` : (symbol.toLowerCase().startsWith('cv') ? `Canopy Vault ${symbol.slice(2)}` : "Canopy Liquidity"));

          const debugSymbol = stakedError
            ? `${symbol} (${stakedError.slice(0, 15)})`
            : symbol;

          if (amount <= 0) return null;

          return {
            id: `canopy_${b.asset_type || b.id || symbol}`,
            protocol: "canopy",
            protocolName: "Canopy Finance",
            protocolWebsite: "https://app.canopyhub.xyz/",
            symbol: debugSymbol,
            name: debugName,
            amount: amount,
            numericValue: usdValue,
            value: amount.toFixed(4),
            usdValue: usdValue,
            underlying: symbol.toLowerCase().startsWith('st') ? symbol.slice(2) : (symbol.toLowerCase().startsWith('cv') ? symbol.slice(2) : "LP Tokens"),
            type: "Liquidity"
          };
        }))).filter(Boolean);

        // 1b. Staked Balance Detection via View Calls (Fallback for vaults not in wallet balances)
        if (client) {
          try {
            const vaultsResult = await client.view({
              payload: {
                function: `${CANOPY_CONFIG.coreVaultsAddress}::satay::vaults_view`,
                typeArguments: [],
                functionArguments: []
              }
            });

            let vaultAddresses: string[] = [];
            if (Array.isArray(vaultsResult)) {
              if (Array.isArray(vaultsResult[0])) {
                vaultAddresses = vaultsResult[0].map((v: any) => typeof v === 'object' && v?.inner ? v.inner : String(v));
              } else {
                vaultAddresses = vaultsResult.map((v: any) => typeof v === 'object' && v?.inner ? v.inner : String(v));
              }
            }

            vaultAddresses = vaultAddresses.filter(addr => addr && addr.startsWith("0x"));

            for (const vaultAddr of vaultAddresses) {
              if (processedVaults.has(vaultAddr.toLowerCase())) continue;

              try {
                const stakedBalanceRes = await client.view({
                  payload: {
                    function: `${CANOPY_CONFIG.rewardsAddress}::multi_rewards::get_user_staked_balance`,
                    typeArguments: [],
                    functionArguments: [targetAddress, vaultAddr]
                  }
                });

                const rawBalance = Number(stakedBalanceRes[0] || 0);
                if (rawBalance > 0) {
                  // Check if we have this vault in allBalances to get metadata
                  const matchingBalance = allBalances.find(b => 
                    b.asset_type && b.asset_type.toLowerCase() === vaultAddr.toLowerCase()
                  );

                  let symbol = matchingBalance?.metadata?.symbol || matchingBalance?.symbol || "";
                  let name = matchingBalance?.metadata?.name || matchingBalance?.name || "";
                  let decimals = matchingBalance?.metadata?.decimals || 8;

                  if (!symbol) {
                    const [symbolRes, nameRes, decimalsRes] = await Promise.all([
                      client.view({
                        payload: {
                          function: "0x1::fungible_asset::symbol",
                          typeArguments: [],
                          functionArguments: [vaultAddr]
                        }
                      }).catch(() => null),
                      client.view({
                        payload: {
                          function: "0x1::fungible_asset::name",
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

                    symbol = String(symbolRes?.[0] || "cvMOVE");
                    name = String(nameRes?.[0] || `Canopy Staked ${symbol}`);
                    decimals = Number(decimalsRes?.[0] || 8);
                  }

                  const amount = rawBalance / Math.pow(10, decimals);
                  const price = resolveTokenPrice(priceMap, vaultAddr, symbol);
                  const usdValue = amount * price;

                  const isSt = symbol.toLowerCase().startsWith('st');
                  const isCv = symbol.toLowerCase().startsWith('cv');
                  const cleanName = isSt ? `Canopy Liquid ${symbol.slice(2)}` : (isCv ? `Canopy Vault ${symbol.slice(2)}` : name);
                  const underlying = isSt ? symbol.slice(2) : (isCv ? symbol.slice(2) : symbol);

                  // De-duplicate if somehow already processed
                  if (!positions.some(p => p.id === `canopy_staked_${vaultAddr}`)) {
                    positions.push({
                      id: `canopy_staked_${vaultAddr}`,
                      protocol: "canopy",
                      protocolName: "Canopy Finance",
                      protocolWebsite: "https://app.canopyhub.xyz/",
                      symbol: symbol,
                      name: cleanName,
                      amount: amount,
                      numericValue: usdValue,
                      value: amount.toFixed(4),
                      usdValue: usdValue,
                      underlying: underlying,
                      type: "Liquidity",
                      source: "view_staked"
                    });
                  }
                }
              } catch (vaultErr) {
                devLog(`Canopy: Error fetching staked balance for vault ${vaultAddr}:`, vaultErr);
              }
            }
          } catch (vaultsErr) {
            devLog("Canopy: Error fetching vaults list:", vaultsErr);
          }
        }

        // 2. Resource-Based Detection Fallback
        if (resources && resources.length > 0) {
          const vaultResources = resources.filter(r => 
            (r.type.includes("::vault::Vault") || r.type.includes("::vault::UserInfo")) &&
            r.type.includes(String(CANOPY_CONFIG.coreVaultsAddress || '').toLowerCase())
          );

          vaultResources.forEach((res, idx) => {
            const resId = `canopy_vault_${idx}`;
            if (!positions.some(p => p.id === resId)) {
              // Basic detection for vault resources if not already found in balances
              const shares = Number(res.data?.shares || 0) / 1e8;
              if (shares > 0) {
                const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
                positions.push({
                  id: resId,
                  protocol: "canopy",
                  protocolName: "Canopy Finance",
                  symbol: "stMOVE",
                  name: "Canopy Vault Position",
                  amount: shares,
                  numericValue: shares * movePrice,
                  value: shares.toFixed(4),
                  usdValue: shares * movePrice,
                  underlying: "MOVE",
                  type: "Liquidity",
                  source: "resource"
                });
              }
            }
          });
        }

        return positions;
      } catch (err) {
        devLog("Canopy discovery error:", err);
        return [];
      }
    }
  }
];
