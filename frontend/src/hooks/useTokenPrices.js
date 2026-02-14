import { useState, useEffect, useCallback, useRef } from "react";
import { INTERVALS, API_CONFIG } from "../config/constants";

// Map Movement Network token addresses to CoinGecko IDs
// CoinGecko provides real-time price data
const COINGECKO_IDS = {
  // Movement Native Token (MOVE) - on Movement Network Mainnet
  "0xa": "movement",
  "0x1": "movement",
  
  // Stablecoins (real addresses on Movement Network)
  // USDT - long address on Movement
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": "tether",
  // USDC - long address on Movement
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": "usd-coin",
  // USDa - Angle USD
  "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650": "usd-coin", // Use USDC as proxy for stablecoin
  // USDe - Ethena USD
  "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c": "ethena-usde",
  
  // WETH on Movement Network
  "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376": "ethereum",
  // weETH - Wrapped eETH
  "0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035": "wrapped-eeth",
  // ezETH - Renzo Restaked ETH
  "0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef": "renzo-restaked-eth",
  // rsETH - Kelp Restaked ETH
  "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d": "kelp-dao-restaked-eth",
  
  // WBTC on Movement Network
  "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c": "bitcoin",
  // LBTC - Lombard BTC
  "0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c": "lombard-staked-btc",
  // SolvBTC
  "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d": "solv-protocol-solvbtc",
};

// Hardcoded fallback prices (if API fails)
// Updated with real Movement token price
const FALLBACK_PRICES = {
  // MOVE token - Movement Network native token
  "0xa": 0.0387,
  "0x1": 0.0387,
  
  // Stablecoins should always be ~1.00
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": 1.00, // USDT
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": 1.00, // USDC
  "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650": 1.00, // USDa
  "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c": 1.00, // USDe
  
  // ETH and variants
  "0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376": 3300, // WETH
  "0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035": 3450, // weETH
  "0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef": 3400, // ezETH
  "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d": 3500, // rsETH
  
  // BTC and variants
  "0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c": 105000, // WBTC
  "0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c": 105000, // LBTC
  "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d": 105000, // SolvBTC
  
  // Meme tokens (small/no value unless they get listed)
  "0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3": 0, // CAPY
  "0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a": 0, // MOVECAT
};

export const useTokenPrices = () => {
  // Initialize with fallback prices immediately so UI can render without waiting
  const [prices, setPrices] = useState(FALLBACK_PRICES);
  const [priceChanges, setPriceChanges] = useState({}); // 24h price changes
  const [loading, setLoading] = useState(false); // Start false since we have fallbacks
  const [error, setError] = useState(null);
  const retryTimeoutRef = useRef(null);

  const fetchPrices = useCallback(async (retryCount = 0) => {
    try {
      setLoading(true);
      setError(null);
      
      // 1. Prepare IDs (filter out placeholder addresses)
      const validIds = Object.entries(COINGECKO_IDS)
        .filter(([address]) => !address.includes("..."))
        .map(([, id]) => id);
      
      if (validIds.length === 0) {
        // No valid IDs, use fallbacks only
        setPrices(FALLBACK_PRICES);
        setPriceChanges({});
        setLoading(false);
        return;
      }

      const ids = validIds.join(",");
      
      // 2. Fetch from CoinGecko (Free API) - include 24h change
      // Create abort controller for timeout (fallback for browsers without AbortSignal.timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.PRICE_FETCH_TIMEOUT);
      
      // Note: CoinGecko has CORS restrictions for direct browser access
      // Try direct first, fallback to CORS proxy if needed
      let response = null;
      const coingeckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      
      try {
        // Try direct fetch first
        response = await fetch(coingeckoUrl, { signal: controller.signal });
      } catch (_e) {
        // If CORS error, try CORS proxy
        console.warn("Direct CoinGecko fetch failed, attempting CORS proxy...");
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(coingeckoUrl)}`;
          response = await fetch(proxyUrl, { signal: controller.signal });
        } catch (_e) {
          console.warn("CORS proxy also failed. Using fallback prices.");
          throw new Error("Price API unavailable (CORS/network). Using fallback prices.");
        }
      }
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // 3. Map Response back to Addresses
      const newPrices = { ...FALLBACK_PRICES };
      const newChanges = {};
      
      Object.keys(COINGECKO_IDS).forEach((address) => {
        // Skip placeholder addresses
        if (address.includes("...")) return;
        
        const geckoId = COINGECKO_IDS[address];
        if (data[geckoId]?.usd) {
          newPrices[address] = data[geckoId].usd;
          // Store 24h change percentage
          if (data[geckoId]?.usd_24h_change !== undefined) {
            newChanges[address] = data[geckoId].usd_24h_change;
          }
          if (import.meta.env.DEV) {
            console.log(`💰 ${address}: $${data[geckoId].usd} (${geckoId}) 24h: ${data[geckoId]?.usd_24h_change?.toFixed(2)}%`);
          }
        }
      });

      if (import.meta.env.DEV) {
        console.log("📊 Real-time prices loaded:", newPrices);
        console.log("📈 24h changes loaded:", newChanges);
      }
      setPrices(newPrices);
      setPriceChanges(newChanges);
      setLoading(false);
    } catch (e) {
      console.warn("Price fetch error:", e.message || e);
      
      // Retry logic with exponential backoff
      if (retryCount < API_CONFIG.MAX_RETRIES) {
        const delay = API_CONFIG.RETRY_DELAY * Math.pow(2, retryCount);
        if (import.meta.env.DEV) {
          console.log(`Retrying price fetch in ${delay}ms (attempt ${retryCount + 1}/${API_CONFIG.MAX_RETRIES})`);
        }
        retryTimeoutRef.current = setTimeout(() => {
          fetchPrices(retryCount + 1);
        }, delay);
      } else {
        // Max retries reached, use fallback prices
        const errorMsg = e.name === 'AbortError' 
          ? "Price fetch timed out. Using fallback values."
          : "Failed to fetch prices. Using fallback values.";
        setError(errorMsg);
        setPrices(FALLBACK_PRICES);
        setPriceChanges({});
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(() => fetchPrices(), INTERVALS.PRICE_UPDATE);
    return () => {
      clearInterval(interval);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [fetchPrices]);

  return { prices, priceChanges, loading, error };
};