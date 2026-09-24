import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isNativePlatform, getElectronAPI } from '@/lib/platform'
import { installNativeBackGuard } from '@/lib/nativeBridge'
import { installDropGuard } from '@/lib/dropGuard'
import { initTheme } from '@/hooks/useTheme'
// الخط مدمج داخل التطبيق (لا تحميل من الإنترنت): نفس المظهر على أندرويد
// وويندوز ولينكس، متصلاً كان الجهاز أو دون اتصال
import '@fontsource-variable/cairo'
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

// السمة تُطبَّق قبل أول رسم (كانت تُقرأ داخل تأثير فتُسبب وميضاً عند الإقلاع)
initTheme()

/**
 * حارس زر الرجوع الأصلي: يُسجَّل قبل رسم الواجهة.
 *
 * على أندرويد: `AppPlugin` يُنهي التطبيق (أو يرجع داخل WebView) إن لم يكن
 * هناك أي مستمع JS لحدث `backButton`. فبين إقلاع التطبيق وجاهزية الواجهة
 * (قراءة قاعدة البيانات، معالج التشغيل الأول) كان زر الرجوع يُنفّذ السلوك
 * الافتراضي للمنصة — أي خروجاً مباشراً من التطبيق. تسجيل الحارس هنا يمنع
 * ذلك، ويفوّض القرار لاحقاً إلى المعالج النشط (`BackNavigationHandler` أو
 * `BootBackHandler`) بلا تكرار في المعالجة.
 *
 * لا يفعل شيئاً على الويب/سطح المكتب (لا حدث رجوع أصلي هناك).
 */
installNativeBackGuard()

registerServiceWorker()

// إفلات ملف فوق النافذة لا يستبدل التطبيق بمحتوى الملف (ويندوز/المتصفح)
installDropGuard()

/**
 * طلب تخزين دائم: يمنع النظام من حذف قاعدة البيانات المحلية (الفواتير
 * والديون) تلقائياً عند امتلاء مساحة الجهاز. صامت تماماً — إن رُفض الطلب
 * يبقى التطبيق يعمل كالمعتاد.
 */
void navigator.storage?.persist?.().catch(() => undefined)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
