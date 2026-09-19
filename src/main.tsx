import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isNativePlatform, getElectronAPI } from '@/lib/platform'
import './index.css'

/**
 * تسجيل عامل الخدمة (Service Worker) للسياسة PWA:
 * - يُسجَّل في المتصفح الحقيقي فقط (الوضع الإنتاجي).
 * - لا يُسجَّل داخل أغلفة Capacitor/Electron: التطبيق هناك محلي بالكامل
 *   والتسجيل كان يفشل سابقاً ويُظهر تنبيه خطأ مزعجاً للمستخدم.
 * - أي فشل في التسجيل يُكتفى بتسجيله في الطرفية — التطبيق يعمل بدونه.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (isNativePlatform() || getElectronAPI()) return
  if (!('serviceWorker' in navigator)) return

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisterError(error) {
          console.warn('تعذّر تسجيل عامل الخدمة — سيكمل التطبيق العمل بشكل طبيعي.', error)
        },
        onOfflineReady() {
          console.info('التطبيق جاهز للعمل دون إنترنت.')
        }
      })
    })
    .catch((error) => {
      console.warn('تعذّر تحميل مُسجِّل عامل الخدمة — سيكمل التطبيق العمل بشكل طبيعي.', error)
    })
}

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
