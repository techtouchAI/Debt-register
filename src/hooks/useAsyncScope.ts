import { useEffect, useState } from 'react';
import type { DependencyList } from 'react';
import { createAbortScope, createMountScope, isBenignLifecycleError, type AbortScope } from '@/lib/lifecycle';
import { reportError } from '@/lib/errors';

/**
 * نطاق غير متزامن مربوط بعمر المكوّن.
 *
 * كل عملية غير متزامنة تبدأ من شاشة (حفظ، تصدير، طباعة، جلب تقرير) تُنفَّذ
 * داخل النطاق، وعند مغادرة الشاشة يُلغى النطاق فيتوقف ما تبقّى من خطوات بدل
 * أن يتابع الكتابة في قاعدة بيانات أُغلقت أو يحدّث واجهة لم تعد موجودة.
 *
 * المرجع ثابت طوال عمر المكوّن، والنطاق الداخلي يتجدّد عند كل تركيب: الإصدار
 * السابق كان يُنشئ النطاق مرة واحدة (`useMemo`) ويلغيه في التنظيف، فبعد دورة
 * "تركيب ← إلغاء ← تركيب" في StrictMode يبقى ملغى إلى الأبد ويفشل كل حفظ
 * بصمت (زر "جاري الحفظ…" عالق والبيانات لا تُكتب).
 *
 * مثال:
 *   const scope = useAsyncScope();
 *   const handleSave = () => scope.runQuiet(async () => {
 *     await updateSettings(...);
 *     scope.throwIfAborted();   // توقّف قبل أي خطوة تالية
 *     ...
 *   });
 */
export function useAsyncScope(): AbortScope {
  const [scope] = useState(() => createMountScope('unmounted'));
  useEffect(() => {
    scope.mount();
    return () => {
      scope.unmount();
    };
  }, [scope]);
  return scope;
}

/**
 * بديل `useEffect` للعمليات غير المتزامنة:
 * يستقبل `AbortSignal` ويُلغيه عند إلغاء التركيب أو تغيّر الاعتماديات،
 * ويعالج الأخطاء غير المتوقعة فقط (الإلغاء يمرّ بصمت).
 */
export function useAsyncEffect(
  effect: (signal: AbortSignal) => void | Promise<void>,
  deps: DependencyList
): void {
  useEffect(() => {
    const scope = createAbortScope('unmounted');
    Promise.resolve()
      .then(() => effect(scope.signal))
      .catch((error) => {
        if (isBenignLifecycleError(error)) return;
        reportError('useAsyncEffect', error);
      });
    return () => {
      scope.abort('unmounted');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
