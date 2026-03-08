import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // use jsdom environment so modules are treated like browser build (avoids
    // SSR export name error)
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.{js,jsx,ts,tsx}'],
  },

});