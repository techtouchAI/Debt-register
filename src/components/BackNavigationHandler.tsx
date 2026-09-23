import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { subscribeNativeBack, type NativeBackEvent } from '@/lib/nativeBridge';
import { closeTopModal, hasOpenModal, openModalCount, subscribeModalStack } from '@/lib/modalStack';
import { installHistoryTrap, syncHistoryTrap } from '@/lib/historyTrap';
import { resolveBackIntent } from '@/lib/backIntent';
import { canExitApp } from '@/lib/appExit';
import { toast } from '@/lib/toast';
import { ExitConfirmDialog } from '@/components/ExitConfirmDialog';

/**
 * المعالج الموحّد لكل طرق الرجوع:
 *
 *   1) زر الرجوع في أندرويد (Capacitor `backButton`).
 *   2) زر الفأرة الخلفي و Alt+← في Electron و Tauri و المتصفح (حدث السجل).
 *   3) Escape (في `lib/modalStack.ts`).
 *
 * القواعد (مطبَّقة في كل المنصات بنفس الترتيب):
 *   - نافذة/درج مفتوح ← يُغلق وحده ولا يتغيّر المسار.
 *   - لسنا في الرئيسية ← رجوع **شاشة واحدة** بالضبط.
 *   - في الرئيسية مع سجل ← رجوع خطوة بدل الخروج.
 *   - في الرئيسية بلا سجل ← حوار تأكيد الخروج: التطبيق لا يخرج أبداً
 *     بضغطة واحدة؛ الخروج النهائي قرار صريح يؤكّده المستخدم.
 *
 * ضمانات إضافية مقابل النسخة السابقة:
 *   - إزالة فخّ السجل لم تعد ترجع خطوة إن تنقّل المستخدم فوقه (نقرة رابط
 *     داخل الدرج الجانبي) — كان ذلك يُلغي التنقل ويترك ضغطات رجوع ميتة.
 *   - مدخل الفخّ القديم يُتجاوز بصمت عند أول رجوع: كل ضغطة = خطوة واحدة.
 */
export function BackNavigationHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  // حوار تأكيد الخروج يُفتح من هنا (عند الرجوع في الرئيسية) ويُغلق بزر
  // الرجوع/Escape مثل أي طبقة عبر مكدس النوافذ.
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  // يُحدَّث في useLayoutEffect لا أثناء الرسم: قراءة/كتابة ref داخل الرسم
  // تكسر ضمانات React (قواعد react-hooks/immutability).
  const pathRef = useRef(location.pathname);
  useLayoutEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

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

      // في الرئيسية ولا رجوع في السجل: الخروج قرار صريح — نعرض حوار
      // التأكيد إن كان الخروج ممكناً على هذه المنصة، وإلا نكتفي بتنبيه.
      if (canExitApp()) setExitConfirmOpen(true);
      else toast.info('أنت في الصفحة الرئيسية');
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

  return <ExitConfirmDialog open={exitConfirmOpen} onClose={() => setExitConfirmOpen(false)} />;
}
