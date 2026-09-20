import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNative } from '@/lib/notify';
import { closeTopModal } from '@/lib/modalStack';
import { toast } from '@/lib/toast';

/**
 * معالج زر الرجوع في أندرويد.
 *
 * السلوك السابق: زر الرجوع يخرج من التطبيق كاملاً من أي شاشة (غير احترافي).
 * السلوك الجديد (المعتمد في تطبيقات أندرويد الاحترافية):
 *  1. إن كانت هناك نافذة مفتوحة (معاينة/نماذج) → تُغلق هي فقط.
 *  2. إن لم نكن في الرئيسية → رجوع للشاشة السابقة.
 *  3. في الرئيسية → الضغطة الأولى تنبيه "اضغط مرة أخرى للخروج"، والثانية
 *     خلال ثانيتين تخرج من التطبيق.
 *
 * يعمل فقط على المنصة الأصلية؛ في المتصفح زر الرجوع يعمل طبيعياً عبر Router.
 */
export function NativeBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let disposed = false;
    let lastExitPress = 0;

    const register = async () => {
      if (!isNative()) return;
      try {
        const { App } = await import('@capacitor/app');
        if (disposed) return;
        handle = await App.addListener('backButton', ({ canGoBack }) => {
          // 1) إغلاق أحدث نافذة مفتوحة
          if (closeTopModal()) return;

          // 2) رجوع داخل التطبيق
          if (pathRef.current !== '/') {
            if (canGoBack) navigate(-1);
            else navigate('/', { replace: true });
            return;
          }

          // 3) في الرئيسية: ضغطتان متتاليتان للخروج
          const now = Date.now();
          if (now - lastExitPress < 2000) {
            void App.exitApp();
          } else {
            lastExitPress = now;
            toast.info('اضغط مرة أخرى للخروج من التطبيق');
          }
        });
      } catch (error) {
        console.warn('تعذّر تسجيل معالج زر الرجوع:', error);
      }
    };

    void register();

    return () => {
      disposed = true;
      handle?.remove().catch(() => undefined);
    };
  }, [navigate]);

  return null;
}
