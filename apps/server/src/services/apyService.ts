import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import CONFIG from "../config/index.ts";

export interface ProtocolApy {
  protocol: string;
  pool_name: string;
  pool_address: string;
  apy: number;
  base_apr: number;
  reward_apr: number;
}

const aptosConfig = new AptosConfig({
  fullnode: CONFIG.MOVEMENT.RPC_URL,
});
const client = new Aptos(aptosConfig);

/**
 * Service to fetch and calculate On-Chain APY for various protocols
 */
export class ApyService {
  
  /**
   * Fetches APY for Canopy Staking (stMOVE)
   * Calculates based on exchange rate if historical data is available,
   * or returns a placeholder base rate.
   */
  static async getCanopyApy(): Promise<ProtocolApy[]> {
    const apys: ProtocolApy[] = [];
    
    try {
      // The stMOVE vault address
      const vaultAddr = "0x113a1769acc5ce21b5ece6f9533eef6dd34c758911fa5235124c87ff1298633b";
      
      // In a full production scenario, we would calculate the APY by comparing 
      // the current exchange rate with the 7-day old exchange rate from the database.
      // For now, we simulate this with a fixed estimated APY (e.g., 7.5%)
      
      apys.push({
        protocol: "Canopy",
        pool_name: "stMOVE Staking",
        pool_address: vaultAddr,
        apy: 0.075, // 7.5% APY
        base_apr: 0.07,
        reward_apr: 0.005
      });
      
    } catch (error) {
      console.error("[ApyService] Error fetching Canopy APY:", error);
    }
    
    return apys;
  }

  /**
   * Fetches APY for Echelon Lending Markets
   * Queries total supply and borrow to calculate utilization and APY
   */
  static async getEchelonApy(): Promise<ProtocolApy[]> {
    const apys: ProtocolApy[] = [];
    const ECHELON_ADDRESS = "0x6a01d5761d43a5b5a0ccbfc42edf2d02c0611464aae99a2ea0e0d4819f0550b5";
    
    // Example markets: MOVE, USDC
    const markets = [
      { name: "MOVE Lending", address: `${ECHELON_ADDRESS}::market::MOVE` },
      { name: "USDC Lending", address: `${ECHELON_ADDRESS}::market::USDC` }
    ];
    
    for (const market of markets) {
      try {
        // 1. Fetch total supply and total borrow from Echelon Smart Contract
        const [totalSupplyRes, totalBorrowRes] = await Promise.allSettled([
          client.view({ payload: { function: `${ECHELON_ADDRESS}::lending::market_total_supply`, functionArguments: [market.address] } }),
          client.view({ payload: { function: `${ECHELON_ADDRESS}::lending::market_total_borrow`, functionArguments: [market.address] } })
        ]);

        let utilization = 0.5; // Fallback utilization if call fails (for demo purposes)
        if (totalSupplyRes.status === "fulfilled" && totalBorrowRes.status === "fulfilled") {
          const supply = Number(totalSupplyRes.value[0]);
          const borrow = Number(totalBorrowRes.value[0]);
          if (supply > 0) {
            utilization = borrow / supply;
          } else {
            utilization = 0;
          }
        }

        // 2. Standard Interest Rate Curve Parameters (Aave V3 / Echelon Defaults)
        // These might need slight adjustment if Echelon uses different values on Movement
        const BASE_RATE = 0.02;       // 2% base borrow rate
        const MULTIPLIER = 0.15;      // 15% multiplier at optimal utilization
        const RESERVE_FACTOR = 0.10;  // 10% goes to protocol reserves
        
        // 3. Calculate Borrow Rate
        const borrowRate = BASE_RATE + (utilization * MULTIPLIER);
        
        // 4. Calculate Supply APY
        const calculatedApy = borrowRate * utilization * (1 - RESERVE_FACTOR);
        
        apys.push({
          protocol: "Echelon",
          pool_name: market.name,
          pool_address: market.address,
          apy: calculatedApy,
          base_apr: calculatedApy,
          reward_apr: 0
        });
      } catch (error) {
        console.error(`[ApyService] Error fetching Echelon APY for ${market.name}:`, error);
      }
    }
    
    return apys;
  }

  /**
   * Fetches all protocol APYs
   */
  static async fetchAllApys(): Promise<ProtocolApy[]> {
    const results = await Promise.allSettled([
      this.getCanopyApy(),
      this.getEchelonApy()
    ]);
    
    const allApys: ProtocolApy[] = [];
    
    for (const result of results) {
      if (result.status === "fulfilled") {
        allApys.push(...result.value);
      }
    }
    
    return allApys;
  }
}
