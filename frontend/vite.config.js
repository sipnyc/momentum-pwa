import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Momentum A2B Navigator',
        short_name: 'Momentum',
        description: 'Advanced Gulf Stream Racing Navigator',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone', // This hides the Safari address bar!
        orientation: 'landscape', // Locks it to the view you want on the pedestal
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3412/3412862.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true // Crucial for Codespaces
  }
});
