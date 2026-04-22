import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Momentum A2B Navigator',
        short_name: 'Momentum',
        description: 'Tactical Routing for Second Storm HR52',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'landscape', // Locks the app to landscape for the helm
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: true, // Allows iPad to connect
    port: 5173
  }
})
