import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';

// Currency symbols and formats
export const CURRENCIES = {
  USD: { symbol: '$', name: 'USD ($)', format: 'prefix' },
  EUR: { symbol: '€', name: 'EUR (€)', format: 'prefix' },
  GBP: { symbol: '£', name: 'GBP (£)', format: 'prefix' },
  JPY: { symbol: '¥', name: 'JPY (¥)', format: 'prefix' },
  INR: { symbol: '₹', name: 'INR (₹)', format: 'prefix' },
  PKR: { symbol: 'Rs', name: 'PKR (Rs)', format: 'prefix' },
};

// Exchange rates relative to USD (these will be fetched in real implementation)
const DEFAULT_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.50,
  INR: 83.12,
  PKR: 278.50,
};

export function useCurrency() {
  const { account } = useWallet();
  const [currency, setCurrencyState] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState(DEFAULT_RATES);
  const [loading, setLoading] = useState(false);

  const settingsKey = account?.address
    ? `settings_${typeof account.address === 'string' ? account.address : account.address.toString()}`
    : 'settings_global';

  // Load currency preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.currency && CURRENCIES[data.currency]) {
          setCurrencyState(data.currency);
        }
      }
    } catch (e) {
      console.error('Failed to load currency settings:', e);
    }
  }, [settingsKey]);

  // Fetch live exchange rates
  useEffect(() => {
    const fetchExchangeRates = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=usd&vs_currencies=usd,eur,gbp,jpy,inr,pkr'
        );
        
        if (response.ok) {
          const data = await response.json();
          // CoinGecko returns rates as 1 USD = X currency
          // We need to invert for our use case
          if (data.usd) {
            setExchangeRates({
              USD: 1,
              EUR: data.usd.eur || DEFAULT_RATES.EUR,
              GBP: data.usd.gbp || DEFAULT_RATES.GBP,
              JPY: data.usd.jpy || DEFAULT_RATES.JPY,
              INR: data.usd.inr || DEFAULT_RATES.INR,
              PKR: data.usd.pkr || DEFAULT_RATES.PKR,
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch exchange rates:', error);
        // Use default rates on error
        setExchangeRates(DEFAULT_RATES);
      } finally {
        setLoading(false);
      }
    };

    fetchExchangeRates();
    // Refresh rates every 5 minutes
    const interval = setInterval(fetchExchangeRates, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const setCurrency = useCallback((newCurrency) => {
    if (!CURRENCIES[newCurrency]) return;
    
    setCurrencyState(newCurrency);
    
    // Save to localStorage
    try {
      const saved = localStorage.getItem(settingsKey);
      const settings = saved ? JSON.parse(saved) : {};
      settings.currency = newCurrency;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save currency settings:', e);
    }
  }, [settingsKey]);

  const convertUSD = useCallback((usdValue, targetCurrency = currency) => {
    if (!usdValue || isNaN(usdValue)) return 0;
    const rate = exchangeRates[targetCurrency] || 1;
    return usdValue * rate;
  }, [currency, exchangeRates]);

  const formatValue = useCallback((value, targetCurrency = currency, decimals = 2) => {
    if (!value || isNaN(value)) return `${CURRENCIES[targetCurrency].symbol}0.00`;
    
    const currencyInfo = CURRENCIES[targetCurrency];
    const formattedNumber = value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    
    if (currencyInfo.format === 'prefix') {
      return `${currencyInfo.symbol}${formattedNumber}`;
    } else {
      return `${formattedNumber} ${currencyInfo.symbol}`;
    }
  }, [currency]);

  return {
    currency,
    setCurrency,
    exchangeRates,
    convertUSD,
    formatValue,
    currencySymbol: CURRENCIES[currency].symbol,
    loading,
  };
}
