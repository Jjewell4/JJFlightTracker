/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Supabase settings for cloud sync. Accepts the VITE_ names plus the unprefixed / NEXT_PUBLIC_
 * names Vercel and the Supabase–Vercel integration use. Only these two public values are
 * exposed to the browser — never the service-role key or other secrets in the environment.
 */
function supabaseEnv(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const urlNames = ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
  const keyNames = [
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ];
  const urlName = urlNames.find((n) => env[n]?.trim());
  const keyName = keyNames.find((n) => env[n]?.trim());
  if (mode === 'production') {
    // Build-log diagnostics: variable NAMES only, never values.
    const seen = Object.keys(env).filter((n) => /SUPABASE/i.test(n)).sort();
    console.log(
      urlName && keyName
        ? `[cloud sync] enabled (URL from ${urlName}, key from ${keyName})`
        : `[cloud sync] disabled — missing ${urlName ? '' : 'SUPABASE_URL '}${keyName ? '' : 'SUPABASE_ANON_KEY'}. Supabase-like variables visible to this build: ${seen.join(', ') || 'none'}`,
    );
  }
  return { url: urlName ? env[urlName]!.trim() : '', key: keyName ? env[keyName]!.trim() : '' };
}

// Relative base so the build works on GitHub Pages sub-paths and any static host.
export default defineConfig(({ mode }) => {
  const supabase = supabaseEnv(mode);
  return {
    base: './',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabase.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabase.key),
    },
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
          // Server functions are never the app: opening /api/... in the browser must reach Vercel.
          navigateFallbackDenylist: [/^\/api\//],
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
  };
});
