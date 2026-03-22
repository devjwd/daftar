import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite Configuration for Movement Network Portfolio Tracker
 * https://vite.dev/config/
 */
export default defineConfig(({ command }) => {
  const vercelDevTarget = process.env.VITE_VERCEL_DEV_URL || 'http://localhost:3001';

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      cssMinify: 'esbuild', // Use esbuild instead of lightningcss for CSS minification
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/@aptos-labs/ts-sdk')) {
              return 'aptos-sdk';
            }
            if (id.includes('node_modules/@aptos-labs/wallet-adapter-react')) {
              return 'aptos-wallet-react';
            }
            if (
              id.includes('node_modules/petra-plugin-wallet-adapter') ||
              id.includes('node_modules/@okwallet/aptos-wallet-adapter') ||
              id.includes('node_modules/@nightlylabs/wallet-adapter-core')
            ) {
              return 'aptos-wallet-plugins';
            }
            if (id.includes('node_modules/@aptos-labs')) {
              return 'aptos-vendor';
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
