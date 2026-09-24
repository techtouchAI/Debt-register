import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setActiveNativeBackHandler, subscribeNativeBack } from '@/lib/nativeBridge';
import { installDesktopBack } from '@/lib/desktopBack';
import { closeTopModal, hasOpenModal, openModalCount, subscribeModalStack } from '@/lib/modalStack';
import { installHistoryTrap, syncHistoryTrap } from '@/lib/historyTrap';
import { resolveBackIntent } from '@/lib/backIntent';
import { canGoBackInApp, currentHistoryIndex, recordHistoryEntry } from '@/lib/navigation';
import { canExitApp } from '@/lib/appExit';
import { toast } from '@/lib/toast';
import { ExitConfirmDialog } from '@/components/ExitConfirmDialog';

/**
 * المعالج الموحّد لكل طرق الرجوع:
 *
 *   1) زر الرجوع في أندرويد (Capacitor `backButton`).
 *   2) زر الفأرة الخلفي و Alt+← في Electron (قناة `back-request` من العملية
 *      الرئيسية) — يمرّان بنفس القرار تماماً كزر أندرويد.
 *   3) زر الرجوع في المتصفح (حدث السجل عبر `historyTrap`).
 *   4) Escape (في `lib/modalStack.ts`).
 *
 * ويُكمله `BootBackHandler` في أسفل هذا الملف لمرحلة ما قبل الموجّه،
 * و`installNativeBackGuard` (في `lib/nativeBridge.ts`) الذي يضمن وجود مستمع
 * أصلي مسجَّل منذ أول لحظة في عمر التطبيق — فلا يُنهي النظام التطبيق أبداً
 * قبل أن تصبح الواجهة جاهزة للقرار.
 *
 * القواعد (في `resolveBackIntent`، بنفس الترتيب في كل المنصات):
 *   - نافذة/درج مفتوح ← يُغلق وحده ولا يتغيّر المسار.
 *   - لسنا في الرئيسية ← رجوع **شاشة واحدة** إلى الصفحة السابقة، أو الصعود
 *     للصفحة الأم إن لم يوجد سجل — فتتقدّم السلسلة دائماً نحو الرئيسية.
 *   - في الرئيسية ← حوار تأكيد الخروج: التطبيق لا يخرج أبداً بضغطة واحدة
 *     ولا يعود من الرئيسية إلى صفحات قديمة في السجل.
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

  // تسجيل مسار كل مدخل في السجل (يستخدمه `useReturnTo` ليرجع بدل أن يدفع
  // نسخة مكررة من الصفحة السابقة). المفتاح يتغيّر مع كل تنقّل حتى لنفس المسار.
  useLayoutEffect(() => {
    recordHistoryEntry(currentHistoryIndex(), location.pathname);
  }, [location.key, location.pathname]);

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

  // قرار الرجوع الموحّد لكل المصادر (أندرويد، زر الفأرة، Alt+←)
  const handleBackRequest = useEffectEvent(() => {
    const intent = resolveBackIntent({
      hasOpenOverlay: hasOpenModal(),
      pathname: pathRef.current,
      // المعيار فهرس React Router داخل التطبيق، لا `canGoBack` من Capacitor
      // الذي يشمل مدخلات خارج التطبيق وفخاخ الطبقات.
      hasInAppHistory: canGoBackInApp()
    });

    switch (intent.action) {
      case 'close-overlay':
        closeTopModal();
        return;
      case 'navigate-back':
        navigate(-1);
        return;
      case 'navigate-up':
        // لا سجل (فتح مباشر أو استعادة بعد إنهاء التطبيق): نستبدل الصفحة
        // بالصفحة الأم حتى لا يتكوّن مدخل يعيد المستخدم إليها لاحقاً.
        navigate(intent.to, { replace: true });
        return;
      case 'confirm-exit':
        // الخروج قرار صريح — حوار تأكيد إن كان الخروج ممكناً على المنصة
        if (canExitApp()) setExitConfirmOpen(true);
        else toast.info('أنت في الصفحة الرئيسية');
        return;
    }
  });

  // (3) حدث الرجوع الأصلي (أندرويد).
  // هذا هو **المعالج النشط** الذي يفوّض إليه الحارس المبكر (المثبَّت في
  // `main.tsx` قبل رسم الواجهة): الحارس يشترك في الحدث الأصلي من أول لحظة
  // فلا يستطيع النظام إنهاء التطبيق قبل جاهزية الواجهة، وهذا المستمع هو
  // صاحب القرار الفعلي. القرار يبقى في مكان واحد — لا معالجة مزدوجة.
  useEffect(() => {
    setActiveNativeBackHandler(() => handleBackRequest());
    let disposed = false;
    let subscription: { remove: () => Promise<void> | void } | undefined;

    void subscribeNativeBack(() => handleBackRequest()).then((next) => {
      if (disposed) {
        void next?.remove();
        return;
      }
      subscription = next;
    });

    return () => {
      setActiveNativeBackHandler(null);
      disposed = true;
      void subscription?.remove();
    };
  }, []);

  // (4) زر الفأرة الخلفي و Alt+← (Electron والمتصفح): نفس قرار زر أندرويد
  useEffect(() => installDesktopBack(() => handleBackRequest()), []);

  return <ExitConfirmDialog open={exitConfirmOpen} onClose={() => setExitConfirmOpen(false)} />;
}

/**
 * معالج الرجوع **قبل وجود الموجّه**: شاشة الإقلاع، معالج التشغيل الأول،
 * وشاشة خطأ التخزين تُعرَض خارج `Router` (لا مسارات ولا صفحات بعد).
 *
 * في هذه المرحلة لا يوجد ما يمكن الرجوع إليه، والسلوك المتوقّع في التطبيقات
 * الأصلية عند قمة الشجرة هو **تأكيد الخروج** — لا الإنفاذ الصامت للخروج.
 * كان الرجوع هنا يقع على السلوك الافتراضي للمنصة (إنهاء النشاط على أندرويد
 * قبل أن تُركَّب الواجهة)، وهو أحد مسارات "يخرج التطبيق فوراً".
 *
 * يستخدم نفس الحوار ونفس قواعد الطبقات (`modalStack`) ونفس مسار الخروج،
 * فتبقى القاعدة واحدة: التطبيق لا يُنهى إلا بقرار صريح من المستخدم.
 */
export function BootBackHandler() {
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const requestBack = useEffectEvent(() => {
    // طبقة مفتوحة (نافذة/درج): تُغلق وحدها — نفس ترتيب الأولويات في كل المنصات.
    if (hasOpenModal()) {
      closeTopModal();
      return;
    }
    if (canExitApp()) setExitConfirmOpen(true);
    else toast.info('أنت في شاشة البداية');
  });

  // مستمع خاص بهذه المرحلة (كما في `BackNavigationHandler`) حتى يعمل القرار
  // بوجود الحارس المبكر وبدونه: الحارس يتولّى الفترة قبل تركيب أي معالج فقط.
  useEffect(() => {
    setActiveNativeBackHandler(() => requestBack());
    let disposed = false;
    let subscription: { remove: () => Promise<void> | void } | undefined;

    void subscribeNativeBack(() => requestBack()).then((next) => {
      if (disposed) {
        void next?.remove();
        return;
      }
      subscription = next;
    });

    return () => {
      setActiveNativeBackHandler(null);
      disposed = true;
      void subscription?.remove();
    };
  }, []);

  return <ExitConfirmDialog open={exitConfirmOpen} onClose={() => setExitConfirmOpen(false)} />;
}
