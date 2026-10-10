import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'BodyBuilder',
        short_name: 'BodyBuilder',
        description: 'Your personal training companion.',
        theme_color: '#10151b',
        background_color: '#10151b',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['client/**/*.{js,css,png,jpg,jpeg,svg,webp,woff2}', 'prerendered/**/*.html'],
        navigateFallback: '/',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true
      }
    })
  ],
  // A dedicated origin avoids reusing another local app's page/service-worker cache.
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true }
});
