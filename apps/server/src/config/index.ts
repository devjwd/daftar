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
  SIGNER: {
    PRIVATE_KEY: string | undefined;
    MODULE_ADDRESS: string | undefined;
  };
  CACHE: {
    VERIFIED_TTL_MS: number;
    PRICE_TTL_MS: number;
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

  SIGNER: {
    PRIVATE_KEY: process.env.BADGE_ATTESTOR_PRIVATE_KEY || process.env.BADGE_SIGNER_PRIVATE_KEY,
    MODULE_ADDRESS: process.env.BADGE_MODULE_ADDRESS,
  },

  CACHE: {
    VERIFIED_TTL_MS: 5 * 60 * 1000, // 5 minutes
    PRICE_TTL_MS: 10 * 60 * 1000,  // 10 minutes
  }
};

// --- CRITICAL ENV VALIDATION ---
const validateBackendConfig = () => {
  const isProd = CONFIG.ENV === 'production';
  const missing: string[] = [];

  if (!CONFIG.SUPABASE.URL) missing.push('SUPABASE_URL');
  if (!CONFIG.SUPABASE.SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!CONFIG.SIGNER.PRIVATE_KEY) missing.push('BADGE_ATTESTOR_PRIVATE_KEY');
  if (!CONFIG.SIGNER.MODULE_ADDRESS) missing.push('BADGE_MODULE_ADDRESS');

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

