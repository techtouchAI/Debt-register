/**
 * منطق "طلب الرجوع" كمكوّن نقي قابل للاختبار.
 *
 * كل طرق الرجوع (زر أندرويد، زر الفأرة الخلفي و Alt+← في سطح المكتب،
 * Escape للطبقات) تمر من هنا بنفس القواعد:
 *
 *   1. طبقة مفتوحة (نافذة/درج جانبي/معاينة) ← تُغلق هي فقط.
 *   2. لسنا في الصفحة الرئيسية وفي السجل صفحة سابقة داخل التطبيق ← الرجوع
 *      إليها (شاشة واحدة بالضبط).
 *   3. لسنا في الرئيسية ولا سجل (فتح مباشر/استعادة بعد إنهاء التطبيق) ←
 *      الصعود إلى الصفحة الأم في الهرم، فيتقدّم الرجوع نحو الرئيسية دائماً.
 *   4. في الصفحة الرئيسية ← حوار تأكيد الخروج. الرئيسية نهاية سلسلة الرجوع:
 *      لا نعود منها إلى صفحات قديمة في السجل، والتطبيق لا يخرج بضغطة واحدة.
 */
import { parentPath } from './navigation';

export interface BackIntentInput {
  /** هل توجد طبقة مفتوحة (نافذة، درج، معاينة)؟ */
  hasOpenOverlay: boolean;
  /** المسار الحالي. */
  pathname: string;
  /** هل توجد صفحة سابقة داخل التطبيق في السجل؟ */
  hasInAppHistory?: boolean;
  /** مسار الصفحة الرئيسية. */
  homePath?: string;
}

export type BackIntent =
  /** أغلق الطبقة العليا فقط. */
  | { action: 'close-overlay' }
  /** ارجع إلى الصفحة السابقة في السجل. */
  | { action: 'navigate-back' }
  /** لا سجل: اصعد إلى الصفحة الأم (استبدال المدخل الحالي). */
  | { action: 'navigate-up'; to: string }
  /** في الرئيسية: اعرض حوار تأكيد الخروج. */
  | { action: 'confirm-exit' };

export const HOME_PATH = '/';

export function resolveBackIntent(input: BackIntentInput): BackIntent {
  const home = input.homePath ?? HOME_PATH;
  if (input.hasOpenOverlay) return { action: 'close-overlay' };
  if (input.pathname === home) return { action: 'confirm-exit' };
  if (input.hasInAppHistory) return { action: 'navigate-back' };
  return { action: 'navigate-up', to: parentPath(input.pathname) };
}
