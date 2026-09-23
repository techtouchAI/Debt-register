import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canGoBackInApp, parentPath, previousInAppPath } from '@/lib/navigation';

/**
 * رجوع "حقيقي" لأزرار الرجوع داخل الصفحات.
 *
 * يرجع مدخلاً واحداً في السجل إن وُجدت صفحة سابقة داخل التطبيق، وإلا يصعد
 * إلى `fallback` (أو الصفحة الأم) باستبدال المدخل الحالي — فلا يُضاف أبداً
 * مدخل جديد يجعل زر النظام يعيد المستخدم إلى الصفحة التي غادرها للتو.
 */
export function useGoBack(): (fallback?: string) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return useCallback(
    (fallback?: string) => {
      if (canGoBackInApp()) navigate(-1);
      else navigate(fallback ?? parentPath(pathname), { replace: true });
    },
    [navigate, pathname]
  );
}

/**
 * العودة إلى صفحة محددة (بعد الحفظ/الحذف) دون تكرار مدخلات السجل:
 *   - إن كانت الصفحة السابقة مباشرة هي `target` أو إحدى `alsoAccept` ⇒ رجوع
 *     حقيقي (`navigate(-1)`)، فيعود المستخدم إلى حيث كان بالضبط.
 *   - وإلا ⇒ استبدال الصفحة الحالية بـ `target`.
 *
 * كان الكود القديم يدفع مدخلاً جديداً (`navigate('/invoices')`) فيتكوّن سجل
 * دائري "القائمة ← النموذج ← القائمة"، ويعيد زر الرجوع المستخدم إلى نموذج
 * مُرسَل أو سجل محذوف بدل التقدّم نحو الصفحة الرئيسية.
 */
export function useReturnTo(): (target: string, alsoAccept?: readonly string[]) => void {
  const navigate = useNavigate();

  return useCallback(
    (target: string, alsoAccept: readonly string[] = []) => {
      const previous = canGoBackInApp() ? previousInAppPath() : undefined;
      if (previous !== undefined && (previous === target || alsoAccept.includes(previous))) navigate(-1);
      else navigate(target, { replace: true });
    },
    [navigate]
  );
}
