import { useState, useEffect, useCallback } from "react";
import { INTERVALS, API_CONFIG } from "../config/constants";

const PRICE_CACHE_KEY = "movement_price_cache_v1";
const PRICE_API_ENDPOINT = "/api/prices";
const SERVER_PRICE_TIMEOUT_MS = 3500;
const DIRECT_PRICE_TIMEOUT_MS = Math.min(API_CONFIG.PRICE_FETCH_TIMEOUT, 5000);
const GMOVE_ADDRESS = "0xba070099efd401e69ae924e31464541bb9c815b9a1866367f07499d9b3698b2c";
const MOVE_PRICE_KEYS = ["0xa", "0x1"];
const USDCX_ADDRESS = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

// Map Movement Network token addresses to CoinGecko IDs
// CoinGecko provides real-time price data
const COINGECKO_IDS = {
  // Movement Native Token (MOVE) - on Movement Network Mainnet
  "0xa": "movement",
  "0x1": "movement",
  [GMOVE_ADDRESS]: "movement",
  
  // Stablecoins (real addresses on Movement Network)
  // USDT - long address on Movement
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": "tether",
  // USDC - long address on Movement
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": "usd-coin",
  // USDCx - use USDC pricing
  [USDCX_ADDRESS]: "usd-coin",
  // USDa - Avalon USD
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

// Safe fallback prices used when API data is unavailable.
// Keep this limited to assets with stable pricing so we do not display stale
// volatile prices (e.g. MOVE, ETH, BTC) during temporary API outages.
const FALLBACK_PRICES = {
  // Stablecoins should always be ~1.00
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d": 1.00, // USDT
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39": 1.00, // USDC
  [USDCX_ADDRESS]: 1.00, // USDCx
  "0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650": 1.00, // USDa
  "0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c": 1.00, // USDe

  // Meme tokens (small/no value unless they get listed)
  "0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3": 0, // CAPY
  "0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a": 0, // MOVECAT
  [GMOVE_ADDRESS]: 0, // gMOVE
};

const applyPriceAliases = (prices = {}, priceChanges = {}) => {
  const nextPrices = { ...prices };
  const nextChanges = { ...priceChanges };

  const movePriceKey = MOVE_PRICE_KEYS.find((key) => Number.isFinite(Number(nextPrices[key])));
  if (movePriceKey) {
    nextPrices[GMOVE_ADDRESS] = Number(nextPrices[movePriceKey]) || 0;
  }

  const moveChangeKey = MOVE_PRICE_KEYS.find((key) => Number.isFinite(Number(nextChanges[key])));
  if (moveChangeKey) {
    nextChanges[GMOVE_ADDRESS] = Number(nextChanges[moveChangeKey]) || 0;
  }

  return { prices: nextPrices, priceChanges: nextChanges };
};

const loadCachedPrices = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const cachedPrices = parsed.prices && typeof parsed.prices === "object" ? parsed.prices : {};
    const cachedChanges = parsed.priceChanges && typeof parsed.priceChanges === "object" ? parsed.priceChanges : {};

    return applyPriceAliases({ ...FALLBACK_PRICES, ...cachedPrices }, cachedChanges);
  } catch {
    return null;
  }
};

const persistCachedPrices = (prices, priceChanges) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      PRICE_CACHE_KEY,
      JSON.stringify({
        prices,
        priceChanges,
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Ignore cache write failures (private mode/quota).
  }
};

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const useTokenPrices = () => {
  // Initialize with cache/fallback prices immediately so UI can render without waiting.
  const [prices, setPrices] = useState(() => loadCachedPrices()?.prices || FALLBACK_PRICES);
  const [priceChanges, setPriceChanges] = useState(() => loadCachedPrices()?.priceChanges || {}); // 24h price changes
  const [loading, setLoading] = useState(false); // Start false since we have fallback/cache data
  const [error, setError] = useState(null);

  const fetchDirectFromCoinGecko = useCallback(async () => {
    const validIds = Object.entries(COINGECKO_IDS)
      .filter(([address]) => !address.includes("..."))
      .map(([, id]) => id);

    const uniqueIds = Array.from(new Set(validIds));

    if (uniqueIds.length === 0) {
      return {
        prices: FALLBACK_PRICES,
        priceChanges: {},
      };
    }

    const ids = uniqueIds.join(",");
    const coingeckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    let response = null;
    try {
      response = await fetchWithTimeout(coingeckoUrl, DIRECT_PRICE_TIMEOUT_MS);
    } catch {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(coingeckoUrl)}`;
      response = await fetchWithTimeout(proxyUrl, DIRECT_PRICE_TIMEOUT_MS);
    }

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const fetchedPrices = {};
    const newChanges = {};

    Object.keys(COINGECKO_IDS).forEach((address) => {
      if (address.includes("...")) return;

      const geckoId = COINGECKO_IDS[address];
      const usdPrice = data?.[geckoId]?.usd;
      if (usdPrice === undefined || usdPrice === null) return;

      fetchedPrices[address] = usdPrice;

      if (data?.[geckoId]?.usd_24h_change !== undefined) {
        newChanges[address] = data[geckoId].usd_24h_change;
      }
    });

    return applyPriceAliases(
      {
        ...FALLBACK_PRICES,
        ...fetchedPrices,
      },
      newChanges,
    );
  }, []);

  const fetchFromServerPricesApi = useCallback(async () => {
    const response = await fetchWithTimeout(PRICE_API_ENDPOINT, SERVER_PRICE_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`Price API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return applyPriceAliases(
      {
        ...FALLBACK_PRICES,
        ...(data?.prices || {}),
      },
      data?.priceChanges || {},
    );
  }, []);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);

    let lastError = null;

    for (let attempt = 0; attempt <= API_CONFIG.MAX_RETRIES; attempt += 1) {
      try {
        let nextSnapshot = null;

        try {
          nextSnapshot = await fetchFromServerPricesApi();
        } catch (serverError) {
          if (import.meta.env.DEV) {
            console.warn("Server price endpoint unavailable, falling back to direct CoinGecko:", serverError?.message || serverError);
          }
          nextSnapshot = await fetchDirectFromCoinGecko();
        }

        let mergedPrices = null;
        let mergedChanges = null;
        setPrices((prev) => {
          const aliasedSnapshot = applyPriceAliases(
            {
              ...FALLBACK_PRICES,
              ...prev,
              ...(nextSnapshot?.prices || {}),
            },
            nextSnapshot?.priceChanges || {},
          );
          mergedPrices = aliasedSnapshot.prices;
          mergedChanges = aliasedSnapshot.priceChanges;
          return mergedPrices;
        });
        setPriceChanges(mergedChanges || {});
        if (mergedPrices) {
          persistCachedPrices(mergedPrices, mergedChanges || {});
        }

        setLoading(false);
        return;
      } catch (e) {
        lastError = e;

        if (attempt >= API_CONFIG.MAX_RETRIES) {
          break;
        }

        const delay = Math.min(API_CONFIG.RETRY_DELAY * Math.pow(2, attempt), 10000);
        if (import.meta.env.DEV) {
          console.log(`Retrying price fetch in ${delay}ms (attempt ${attempt + 1}/${API_CONFIG.MAX_RETRIES})`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.warn("Price fetch error:", lastError?.message || lastError);
    const errorMsg = lastError?.name === 'AbortError'
      ? "Price fetch timed out. Using fallback values."
      : "Failed to fetch prices. Using fallback values.";
    setError(errorMsg);
    setPrices((prev) => applyPriceAliases({
            ...FALLBACK_PRICES,
            ...prev,
    }).prices);
    setPriceChanges((prev) => applyPriceAliases({}, prev).priceChanges);
    setLoading(false);
  }, [fetchFromServerPricesApi, fetchDirectFromCoinGecko]);

  useEffect(() => {
    const kickoffId = setTimeout(() => {
      void fetchPrices();
    }, 0);
    const interval = setInterval(() => {
      void fetchPrices();
    }, INTERVALS.PRICE_UPDATE);
    return () => {
      clearTimeout(kickoffId);
      clearInterval(interval);
    };
  }, [fetchPrices]);

  return { prices, priceChanges, loading, error };
};