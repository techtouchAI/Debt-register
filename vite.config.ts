import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  // مسارات نسبية: يعمل البناء تحت file:// (Electron/Tauri/فتح الملف مباشرة)
  // وأي استضافة في مسار فرعي دون كسر تحميل الأصول
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'إدارة المكتب الزراعي',
        short_name: 'المكتب الزراعي',
        description: 'نظام متكامل لإدارة المكتب الزراعي - المخزن والعملاء والفواتير والديون - يعمل بدون انترنت',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        display: 'standalone',
        scope: './',
        start_url: './',
        orientation: 'any',
        lang: 'ar',
        dir: 'rtl',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // السماح بمعاينة التطبيق عبر مضيفات المعاينة (لا يؤثر على البناء النهائي)
    allowedHosts: ['.e2b.app', 'localhost']
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.e2b.app', 'localhost']
  },
  build: {
    // تقسيم الحزم: يقلّل حجم الملف الرئيسي ويمنع تحذير 500KB
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          dexie: ['dexie', 'dexie-react-hooks'],
          pdf: ['jspdf'],
          icons: ['lucide-react']
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true
  }
})
