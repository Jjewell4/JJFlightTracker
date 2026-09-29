/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Relative base so the build works on GitHub Pages sub-paths and any static host.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'favicon.svg'],
      manifest: false, // served from public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Airline logos: show cached ones offline, refresh in the background. The <img> is
            // no-cors, so responses are opaque (status 0) and browsers pad each one heavily
            // against the storage quota — keep the cache small.
            urlPattern: ({ url }) => url.hostname === 'pics.avs.io',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'airline-logos',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Map tiles, glyphs and sprites are immutable for a given URL: cache first.
            urlPattern: ({ url }) => url.hostname.endsWith('openfreemap.org') && /\.(pbf|mvt|png|jpe?g|webp)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Style JSON / TileJSON point at versioned tile URLs that change when the map data
            // is rebuilt: serve the cached copy (offline) but always refresh it.
            urlPattern: ({ url }) => url.hostname.endsWith('openfreemap.org'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-styles',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
