import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // Relative asset URLs, NOT the default absolute '/'. This app is deployed into a
  // SharePoint site, where it is served from a nested path like
  // /sites/<site>/SiteAssets/<app>/ rather than the domain root - with the default base the
  // built index.html requests /assets/index-*.js off the domain root and 404s against every
  // one of its own bundles (blank page). './' resolves them next to index.html wherever it
  // lands. Public-folder assets use import.meta.env.BASE_URL for the same reason.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // jsdom so component tests (.test.jsx) can render real DOM via Testing Library; the
    // pure-logic tests (.test.ts) don't touch the DOM so the extra environment cost is
    // negligible for a suite this size.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
