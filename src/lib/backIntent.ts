/**
 * منطق "طلب الرجوع" كمكوّن نقي قابل للاختبار.
 *
 * كل طرق الرجوع (زر أندرويد، زر الفأرة الخلفي، Alt+←، Escape) تمر من هنا
 * بنفس القواعد، فتُختبر مرة واحدة بدل تكرار المنطق في كل مكوّن:
 *
 *   1) طبقة مفتوحة (نافذة/درج جانبي/معاينة) ← تُغلق هي فقط.
 *   2) لسنا في الصفحة الرئيسية ← الرجوع شاشة واحدة داخل التطبيق.
 *   3) في الصفحة الرئيسية ← لا شيء: التطبيق لا يخرج ولا يُغلق.
 */

export interface BackIntentInput {
  /** هل توجد طبقة مفتوحة (نافذة، درج، معاينة)؟ */
  hasOpenOverlay: boolean;
  /** المسار الحالي. */
  pathname: string;
  /** هل يمكن الرجوع في سجل التصفّح؟ (canGoBack من Capacitor) */
  canGoBackInHistory?: boolean;
  /** مسار الصفحة الرئيسية. */
  homePath?: string;
}

export type BackIntent =
  /** أغلق الطبقة العليا فقط. */
  | { action: 'close-overlay' }
  /** ارجع شاشة واحدة داخل التطبيق. */
  | { action: 'navigate-back' }
  /** نحن في الرئيسية ويمكن الرجوع في السجل (مسارات أعمق) — ارجع أيضاً. */
  | { action: 'navigate-back' }
  /** في الرئيسية: ابقَ في التطبيق ولا تغلقه. */
  | { action: 'stay-home' };

export const HOME_PATH = '/';

export function resolveBackIntent(input: BackIntentInput): BackIntent {
  const home = input.homePath ?? HOME_PATH;
  if (input.hasOpenOverlay) return { action: 'close-overlay' };
  if (input.pathname !== home) return { action: 'navigate-back' };
  // حتى في الرئيسية: إذا كان في السجل مدخلات (وصول مباشر ثم تنقّل داخلي)
  // نرجع بدل الخروج، فالمستخدم لا يفقد مكانه.
  if (input.canGoBackInHistory) return { action: 'navigate-back' };
  return { action: 'stay-home' };
}
