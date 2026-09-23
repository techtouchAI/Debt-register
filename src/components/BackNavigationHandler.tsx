import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { subscribeNativeBack, type NativeBackEvent } from '@/lib/nativeBridge';
import { closeTopModal, hasOpenModal, openModalCount, subscribeModalStack } from '@/lib/modalStack';
import { installHistoryTrap, syncHistoryTrap } from '@/lib/historyTrap';
import { resolveBackIntent } from '@/lib/backIntent';
import { toast } from '@/lib/toast';

/**
 * المعالج الموحّد لكل طرق الرجوع:
 *
 *   1) زر الرجوع في أندرويد (Capacitor `backButton`).
 *   2) زر الفأرة الخلفي و Alt+← في Electron و Tauri و المتصفح (حدث السجل).
 *   3) Escape (في `lib/modalStack.ts`).
 *
 * القواعد (مطبَّقة في كل المنصات بنفس الترتيب):
 *   - نافذة/درج مفتوح ← يُغلق ولا يتغيّر المسار.
 *   - لسنا في الرئيسية ← رجوع شاشة واحدة.
 *   - في الرئيسية ← البقاء داخل التطبيق (لا خروج، ولا إغلاق نافذة).
 *
 * السلوك السابق كان يترك زر الرجوع في Electron/Tauri وبالمتصفح يغيّر المسار
 * والنافذة مفتوحة (تضارب بين الواجهة والمسار) — الآن المسار لا يتغيّر إلا
 * بعد إغلاق آخر طبقة.
 */
export function BackNavigationHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  // (1) مزامنة فخّ السجل مع عدد الطبقات المفتوحة (فتح/إغلاق/إغلاق الكل)
  useEffect(() => {
    return subscribeModalStack((entries) => {
      syncHistoryTrap(entries.length);
    });
  }, []);

  // (2) اعتراض الرجوع في السجل — يشمل المتصفح و Electron و Tauri
  useEffect(() => {
    return installHistoryTrap(closeTopModal, openModalCount);
  }, []);

  // (3) حدث الرجوع الأصلي (أندرويد)
  useEffect(() => {
    let disposed = false;
    let subscription: { remove: () => Promise<void> | void } | undefined;

    const handleNativeBack = (event: NativeBackEvent) => {
      const intent = resolveBackIntent({
        hasOpenOverlay: hasOpenModal(),
        pathname: pathRef.current,
        canGoBackInHistory: event.canGoBack
      });

      if (intent.action === 'close-overlay') {
        closeTopModal();
        return;
      }

      if (intent.action === 'navigate-back') {
        if (event.canGoBack) navigate(-1);
        else navigate('/', { replace: true });
        return;
      }

      // في الصفحة الرئيسية: لا نستدعي exitApp أبداً — يبقى التطبيق مفتوحاً.
      toast.info('أنت في الصفحة الرئيسية');
    };

    void subscribeNativeBack(handleNativeBack).then((next) => {
      if (disposed) {
        void next?.remove();
        return;
      }
      subscription = next;
    });

    return () => {
      disposed = true;
      void subscription?.remove();
    };
  }, [navigate]);

  return null;
}
