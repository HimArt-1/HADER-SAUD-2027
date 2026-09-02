import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Check if building for Electron
const isElectron = process.env.ELECTRON === 'true';
const isPwaEnabled = !isElectron && String(process.env.VITE_ENABLE_PWA || '').toLowerCase() === 'true';

// Expose package.json version to the client at build time so the desktop
// downloader and diagnostics page can show a consistent fingerprint.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = (() => {
  try {
    const raw = readFileSync(resolve(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();

export default defineConfig({
  plugins: [
    react(),
    // PWA - skip for Electron builds
    ...(isPwaEnabled ? [VitePWA({
      registerType: 'autoUpdate',
      minify: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'logo192.png', 'logo512.png', 'manifest.json'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/downloads\//, /^\/api\//],
        // Cache strategies
        runtimeCaching: [
          {
            // Lazy route chunks: cache after first use so mobile installs stay light.
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin && request.destination === 'script' && url.pathname.startsWith('/assets/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'hader-route-chunks',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Same-origin images and icons.
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'hader-images',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
        ],
        // Pre-cache app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [
          // Keep first install light; these feature chunks are cached after use.
          'assets/Admin-*.js',
          'assets/Parents-*.js',
          'assets/Support-*.js',
          'assets/Supervision-*.js',
          'assets/Kiosk-*.js',
          'assets/WhatsAppControl-*.js',
          'assets/TelegramControl-*.js',
          'assets/Reports-*.js',
          'assets/MobileScanner-*.js',
          'assets/vendor-camera-*.js',
          'assets/vendor-barcode-*.js',
          'assets/vendor-charts-*.js',
          'assets/vendor-motion-*.js',
          'assets/vendor-html2canvas-*.js',
          'assets/vendor-jspdf-*.js',
          'assets/vendor-image-export-*.js',
          'assets/xlsx-*.js',
          'assets/jszip.min-*.js',
          'assets/BadgeStudio-*.js',
          'assets/QuickSendModal-*.js',
          'images/*_guide_hero.webp'
        ]
      },
      manifest: false, // Use existing manifest.json from public/
    })] : [])
  ],
  // Use relative paths for Electron file:// protocol
  base: isElectron ? './' : '/',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Ensure assets work with file:// protocol in Electron
    assetsDir: 'assets',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React — always loaded
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Supabase API client
          'vendor-supabase': ['@supabase/supabase-js'],
          // Charts — loaded only with pages that need charts
          'vendor-charts': ['recharts'],
          // Camera scanner and barcode generation are separate workflows.
          'vendor-camera': ['html5-qrcode'],
          'vendor-barcode': ['jsbarcode', 'qrcode'],
          // Storage, crypto, and optional export tooling should not pull each other into early routes.
          'vendor-dexie': ['dexie'],
          'vendor-crypto': ['crypto-js'],
          'vendor-html2canvas': ['html2canvas'],
          'vendor-jspdf': ['jspdf'],
          'vendor-image-export': ['html-to-image'],
          // Icons are needed broadly; animation is only needed by motion-heavy pages.
          'vendor-icons': ['lucide-react'],
          'vendor-motion': ['framer-motion'],
        }
      }
    },
  },
  // Define global constants
  define: {
    __IS_ELECTRON__: JSON.stringify(isElectron),
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
});
