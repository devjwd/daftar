/// <reference types="vite/client" />
/**
 * Environment variable validator and accessor
 */

export const getEnv = (key: string, fallback: any = undefined): string => {
  const value = import.meta.env[key];
  const isMissing = value === undefined || value === null || value === '';

  if (isMissing) {
    if (fallback !== undefined) return fallback;
    
    const errorMsg = `CRITICAL: Environment variable ${key} is missing!`;
    if (import.meta.env.PROD) {
      // In production, we log instead of throw to avoid a completely blank screen
      console.error(errorMsg);
      return '';
    }
    console.error(errorMsg);
    return '';
  }
  return value;
};

/**
 * Validate all required environment variables at startup.
 */
export const validateRequiredEnvs = () => {
  const required = [
    'VITE_API_URL',
    'VITE_NETWORK'
  ];

  const missing = required.filter(key => {
    const val = import.meta.env[key];
    // VITE_API_URL is allowed to be empty string for relative proxying (Vercel rewrites)
    if (key === 'VITE_API_URL' && val === '') return false;
    return val === undefined || val === null;
  });
  
  if (missing.length > 0) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    if (import.meta.env.PROD) {
      // In production, we log instead of throw to avoid a completely blank screen
      // unless it's absolutely critical.
      console.error(`[CRITICAL] ${msg}`);
      return;
    }
    console.error(`[EnvValidator] ${msg}`);
  }
};

export const isDev = (): boolean => import.meta.env.DEV;
export const isProd = (): boolean => import.meta.env.PROD;
