import dotenv from 'dotenv';

// Load .env from server root
dotenv.config();

export interface Config {
  PORT: string | number;
  ENV: string;
  NETWORK: string;
  MOVEMENT: {
    RPC_URL: string;
    INDEXER_URL: string;
  };
  SUPABASE: {
    URL: string | undefined;
    SERVICE_ROLE_KEY: string | undefined;
  };

  CACHE: {
    VERIFIED_TTL_MS: number;
    PRICE_TTL_MS: number;
  };
  TRADEPORT: {
    API_KEY: string | undefined;
    API_USER: string | undefined;
    ENDPOINT: string | undefined;
  };
}

export const CONFIG: Config = {
  PORT: process.env.PORT || 3001,
  ENV: process.env.NODE_ENV || 'development',
  NETWORK: process.env.NETWORK || 'mainnet',

  MOVEMENT: {
    RPC_URL: process.env.MOVEMENT_RPC_URL || 'https://mainnet.movementnetwork.xyz/v1',
    INDEXER_URL: process.env.MOVEMENT_INDEXER_URL || 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql',
  },

  SUPABASE: {
    URL: process.env.SUPABASE_URL,
    SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },



  CACHE: {
    VERIFIED_TTL_MS: 15 * 60 * 1000, // 15 minutes
    PRICE_TTL_MS: 10 * 60 * 1000,  // 10 minutes
  },

  TRADEPORT: {
    API_KEY: process.env.TRADEPORT_API_KEY || process.env.VITE_TRADEPORT_API_KEY,
    API_USER: process.env.TRADEPORT_API_USER || process.env.VITE_TRADEPORT_API_USER || 'daftar',
    ENDPOINT: process.env.INDEXER_XYZ_ENDPOINT || 'https://api.indexer.xyz/graphql',
  }
};

// --- CRITICAL ENV VALIDATION ---
const validateBackendConfig = () => {
  const isProd = CONFIG.ENV === 'production';
  const missing: string[] = [];

  if (!CONFIG.SUPABASE.URL) missing.push('SUPABASE_URL');
  if (!CONFIG.SUPABASE.SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');


  if (missing.length > 0) {
    const msg = `[CRITICAL] Missing environment variables: ${missing.join(', ')}`;
    if (isProd) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
  }
};

validateBackendConfig();

export default CONFIG;

