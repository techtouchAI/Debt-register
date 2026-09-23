import { useEffect, useMemo } from 'react';
import type { DependencyList } from 'react';
import { createAbortScope, isBenignLifecycleError, type AbortScope } from '@/lib/lifecycle';
import { reportError } from '@/lib/errors';

/**
 * نطاق غير متزامن مربوط بعمر المكوّن.
 *
 * كل عملية غير متزامنة تبدأ من شاشة (حفظ، تصدير، طباعة، جلب تقرير) تُنفَّذ
 * داخل النطاق، وعند مغادرة الشاشة يُلغى النطاق فيتوقف ما تبقّى من خطوات بدل
 * أن يتابع الكتابة في قاعدة بيانات أُغلقت أو يحدّث واجهة لم تعد موجودة.
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
  const scope = useMemo(() => createAbortScope('unmounted'), []);
  useEffect(() => {
    return () => {
      scope.abort('unmounted');
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
