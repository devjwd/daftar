import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite Configuration for Movement Network Portfolio Tracker
 * https://vite.dev/config/
 */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '');
  const vercelDevTarget = env.VITE_VERCEL_DEV_URL || 'http://127.0.0.1:3001';

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: true,
      minify: 'esbuild',
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/recharts')) {
              return 'recharts';
            }
            if (id.includes('node_modules/framer-motion')) {
              return 'framer-motion';
            }
            if (id.includes('node_modules/@aptos-labs') || id.includes('wallet-adapter')) {
              return 'aptos-wallet';
            }
            if (id.includes('node_modules/@supabase')) {
              return 'supabase';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'lucide-react';
            }
          },
        },
      },
    },
    server: {
      port: 3000,
      open: true,
      proxy: command === 'serve'
        ? {
            '/api': {
              target: vercelDevTarget,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
    preview: {
      port: 3000,
    },
  };
})
