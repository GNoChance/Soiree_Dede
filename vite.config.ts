import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  // Dev (npm run dev) : sans cette liste, le pré-bundle de Vite 8 produisait DEUX copies de React
  // (framer-motion / zustand / lucide sur l'une, l'appli sur l'autre) → « Invalid hook call », page blanche.
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      'framer-motion', 'lucide-react', 'zustand', 'react-router',
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Les Soirées de Dédé',
        short_name: 'Soirées Dédé',
        description: 'Mini-jeux de soirée entre amis : Qui de nous ?, Undercover et plus encore.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        id: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#FFB703',
        background_color: '#FFF6E5',
        categories: ['games', 'entertainment', 'social'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico}'],
        // Tous les fichiers JS sont pré-téléchargés, y compris les scènes 3D (bowling, Dédé Kart) :
        // une version installée est toujours complète, même après une nouvelle mise en ligne.
        // (Exclure un fichier le rend introuvable pour les anciennes versions dès qu'il change de nom.)
        // Les vidéos « Comment on joue ? » (public/tutos/*.mp4) ne sont volontairement NI pré-téléchargées
        // (pas de mp4 dans globPatterns) NI mises en cache par le service worker : lecture en streaming
        // réseau, avec les requêtes « Range » gérées nativement par le navigateur.
        // Notifications push (rappel du défi du jour) : public/push-sw.js, chargé par le SW généré.
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/tutos\//, /^\/videos\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/chibis/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'chibis',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Dictionnaire de la Bombe à mots (~1 Mo) : téléchargé une fois puis gardé.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/dicts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'dicts', expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 180 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
        ],
      },
    }),
  ],
})
