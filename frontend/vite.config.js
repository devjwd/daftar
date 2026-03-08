import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite Configuration for Movement Network Portfolio Tracker
 * https://vite.dev/config/
 */
export default defineConfig({
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
  },
  preview: {
    port: 3000,
  },
})
