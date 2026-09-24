import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * موضع التمرير عند التنقّل بين الصفحات — كما في التطبيقات الأصلية.
 *
 * بدون هذا المكوّن كانت الصفحة الجديدة تُفتح بنفس موضع تمرير الصفحة السابقة
 * (تفتح فاتورة من أسفل القائمة فتظهر صفحتها من منتصفها، وبعد معالج الإعداد
 * تظهر الرئيسية مُمرَّرة للأسفل)، والرجوع يعيد المستخدم إلى أعلى القائمة
 * فيضيع مكانه.
 *
 *   - فتح صفحة جديدة (رابط، زر، استبدال) ⇒ من أعلى الصفحة.
 *   - الرجوع (زر أندرويد، زر الفأرة الخلفي، Alt+←) ⇒ نفس الموضع الذي غادره
 *     المستخدم في تلك الصفحة.
 *
 * `HashRouter` لا يدعم مكوّن ScrollRestoration الجاهز (خاص بموجّهات البيانات)
 * لذلك نحفظ الموضع لكل مدخل في السجل (`location.key`). فخاخ النوافذ في السجل
 * تحتفظ بنفس المفتاح، فلا يتغيّر التمرير عند إغلاق نافذة بزر الرجوع.
 */
const RESTORE_TIMEOUT_MS = 600;

function scrollToY(y: number): void {
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollTo(0, y);
  }
}

export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const currentKey = useRef(location.key);

  // المتصفح لا يستعيد التمرير بنفسه فوق استعادتنا (قفزة مزدوجة)
  useLayoutEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // حفظ موضع الصفحة الحالية أثناء التمرير (مرة لكل إطار على الأكثر)
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positions.current.set(currentKey.current, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    currentKey.current = location.key;
    const saved = navigationType === 'POP' ? positions.current.get(location.key) : undefined;
    if (saved === undefined || saved <= 0) {
      scrollToY(0);
      return;
    }

    // محتوى الصفحة يصل من قاعدة البيانات بعد أول رسم: نعيد المحاولة حتى
    // يصبح طول الصفحة كافياً للوصول إلى الموضع المحفوظ (أو تنتهي المهلة)
    let frame = 0;
    const started = performance.now();
    const attempt = () => {
      scrollToY(saved);
      const reached = Math.abs(window.scrollY - saved) < 2;
      if (!reached && performance.now() - started < RESTORE_TIMEOUT_MS) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [location.key, navigationType]);

  return null;
}
