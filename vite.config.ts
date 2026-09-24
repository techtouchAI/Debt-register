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
      // التسجيل يدوي من main.tsx: لا يُسجَّل عامل الخدمة داخل أغلفة
      // Capacitor/Electron (لا حاجة له هناك وقد يفشل فيُقلق المستخدم)
      injectRegister: false,
      includeAssets: ['vite.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'إدارة المكتب',
        short_name: 'إدارة المكتب',
        description: 'نظام متكامل لإدارة المكتب - المخزن والعملاء والفواتير والديون - يعمل بدون انترنت',
        theme_color: '#151412',
        background_color: '#f8f7f5',
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
      // import.meta.dirname متاح في Node 20.11+ وهو المسار الذي يتوقعه مُحمِّل
      // الإعداد الأصلي في Vite (__dirname غير مدعوم هناك).
      '@': path.resolve(import.meta.dirname, './src')
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
    // أكبر حزمة هي مولّد PDF (jspdf + html2canvas ≈ 780KB) وهي **مُحمّلة
    // تأخيرياً** (تُستدعى عند الطباعة/حفظ PDF فقط)، فرفع حد التحذير هنا مقصود
    // ومُوثّق بدل تقسيمها عبثاً إلى ملفات صغيرة تُحمَّل معاً دائماً.
    chunkSizeWarningLimit: 900,
    // تقسيم الحزم: يقلّل حجم الملف الرئيسي. Rspack/Rolldown في Vite 8
    // يتطلب دالة (`manualChunks` بصيغة كائن لم تعد مدعومة).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react'
          }
          if (/[\\/]node_modules[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'dexie'
          if (/[\\/]node_modules[\\/](jspdf|html2canvas|canvg|dompurify|fflate)[\\/]/.test(id)) return 'pdf'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'icons'
          return undefined
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
