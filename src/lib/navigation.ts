/**
 * أدوات التنقّل الهرمي داخل التطبيق.
 *
 * القاعدة المعتمدة لكل طرق الرجوع (زر النظام، زر الفأرة، أزرار "رجوع" داخل
 * الصفحات): **الرجوع يعيد الصفحة السابقة فعلاً ولا يُنشئ مدخلاً جديداً في
 * السجل**. الأزرار القديمة كانت تستدعي `navigate('/invoices')` (دفع مدخل
 * جديد) فيتكوّن سجل دائري: القائمة ← الفاتورة ← القائمة، ثم يعيد زر النظام
 * المستخدم إلى الفاتورة بدل أن يتقدّم نحو الصفحة الرئيسية.
 */

/**
 * هل يوجد مدخل سابق **داخل التطبيق** يمكن الرجوع إليه؟
 *
 * React Router يحفظ فهرس المدخل (`idx`) في `history.state`؛ الفهرس 0 يعني أن
 * هذه أول صفحة فُتحت في الجلسة (تشغيل التطبيق أو رابط مباشر)، فالرجوع في
 * السجل عندها يغادر التطبيق نفسه — وهو ما لا نريده أبداً.
 */
export function canGoBackInApp(): boolean {
  if (typeof window === 'undefined') return false;
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

/**
 * الصفحة الأم في الهرم: `/invoices/5/edit` ← `/invoices/5` ← `/invoices` ← `/`.
 * تُستخدم عندما لا يوجد سجل (فتح مباشر على صفحة داخلية أو استعادة أندرويد
 * للتطبيق بعد إنهائه) حتى يتقدّم الرجوع نحو الرئيسية خطوة واحدة في كل مرة.
 */
export function parentPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  return `/${segments.slice(0, -1).join('/')}`;
}

/* ------------------------------------------------------------------ *
 * سجل المسارات داخل التطبيق (للرجوع إلى صفحة محددة بلا تكرار مدخلات)
 * ------------------------------------------------------------------ */

const pathsByIndex = new Map<number, string>();

/** فهرس المدخل الحالي في السجل كما يحفظه React Router (أو null). */
export function currentHistoryIndex(): number | null {
  if (typeof window === 'undefined') return null;
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number' ? state.idx : null;
}

/** تسجيل المسار المعروض عند فهرسه (يُستدعى مع كل تغيّر في الموقع). */
export function recordHistoryEntry(index: number | null, path: string): void {
  if (index === null) return;
  pathsByIndex.set(index, path);
}

/** المسار في المدخل السابق مباشرة داخل التطبيق (إن كان معروفاً). */
export function previousInAppPath(): string | undefined {
  const index = currentHistoryIndex();
  if (index === null || index <= 0) return undefined;
  return pathsByIndex.get(index - 1);
}

/** للاختبارات فقط. */
export function resetHistoryEntriesForTests(): void {
  pathsByIndex.clear();
}
