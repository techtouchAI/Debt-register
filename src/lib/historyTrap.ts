/**
 * فخّ سجل التصفح (History Trap) لجعل زر الرجوع "يغلق النافذة أولاً" في
 * المتصفح و Electron و Tauri وليس في أندرويد فقط.
 *
 * الفكرة: عند فتح أول طبقة (نافذة/درج/معاينة) ندفع مدخلاً في السجل بنفس
 * الرابط الحالي ونضع عليه علامة. فعندما يضغط المستخدم زر الرجوع (الفأرة
 * الخلفي أو Alt+← أو زر المتصفح) يأخذ السجل خطوة إلى المدخل السابق — وهو
 * بنفس الرابط، فلا يتغيّر المسار — فنلتقط الحدث ونغلق الطبقة وحدها.
 *
 * تفاصيل مهمّة:
 *  - نحافظ على بيانات حالة السجل الخاصة بـ React Router (`usr/key/idx`)
 *    ولا نستبدلها، لأن مكتبة التوجيه تعتمد على `idx` لحساب مقدار الرجوع.
 *  - عند إغلاق آخر طبقة بإجراء المستخدم (زر الإغلاق/حفظ) نُزيل المدخل
 *    الإضافي بـ `history.back()` حتى لا يفقد المستخدم ضغطة رجوع في المستقبل.
 *  - الرجوع البرمجي الذي نُنفّذه نحن (لإزالة المدخل) لا يُحسب كطلب رجوع من
 *    المستخدم، ويُتجاهل عبر عدّاد داخلي.
 *  - الوحدة قابلة للاختبار: محوّل السجل (adapter) قابل للاستبدال بالكامل.
 */

const TRAP_KEY = '__agriOfficeOverlayTrap';

export interface HistoryAdapter {
  pushState(state: unknown, title: string, url?: string | null): void;
  back(): void;
  readonly state: unknown;
  readonly href: string;
}

function defaultAdapter(): HistoryAdapter {
  const history = window.history;
  return {
    pushState: (state, title, url) => history.pushState(state, title, url),
    back: () => history.back(),
    get state() {
      return history.state;
    },
    get href() {
      return window.location.href;
    }
  };
}

let adapter: HistoryAdapter | null = null;
let armed = false;
let pendingProgrammaticBacks = 0;
let installedCleanup: (() => void) | undefined;

function historyAdapter(): HistoryAdapter {
  if (!adapter) adapter = defaultAdapter();
  return adapter;
}

export function isOverlayTrapState(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[TRAP_KEY] === true);
}

/** حالة الفخ الحالية: true إذا كان المدخل الحالي هو مدخل الطبقات. */
export function isTrapArmed(): boolean {
  return armed;
}

/** استبدال محوّل السجل — للاختبارات فقط. */
export function setHistoryAdapterForTests(next: HistoryAdapter | null): void {
  adapter = next;
  armed = false;
  pendingProgrammaticBacks = 0;
}

function armTrap(): void {
  if (armed) return;
  const history = historyAdapter();
  const current = history.state;
  const preserved = current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
  // نفس الرابط تماماً، مع الاحتفاظ بحالة React Router وإضافة علامتنا.
  history.pushState({ ...preserved, [TRAP_KEY]: true }, '', history.href);
  armed = true;
}

function disarmTrap(): void {
  if (!armed) return;
  armed = false;
  // الرجوع البرمجي: مدخل واحد فقط إلى الوراء (لنفس الرابط) لإزالة الفخ.
  pendingProgrammaticBacks += 1;
  historyAdapter().back();
}

/**
 * مزامنة الفخ مع عدد الطبقات المفتوحة.
 * تُستدعى بعد كل تغيّر في المكدس (فتح طبقة، إغلاقها، إغلاق الكل).
 */
export function syncHistoryTrap(openOverlays: number): void {
  if (typeof window === 'undefined') return;
  if (openOverlays > 0) armTrap();
  else disarmTrap();
}

/**
 * تثبيت مستمع الرجوع.
 * @param closeTopOverlay يُغلق الطبقة العليا ويُعيد true إذا أُغلقت واحدة.
 * @param countOpenOverlays عدد الطبقات المفتوحة حالياً.
 * @returns دالة إزالة المستمع.
 */
export function installHistoryTrap(
  closeTopOverlay: () => boolean,
  countOpenOverlays: () => number
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (installedCleanup) return installedCleanup;

  const onPopState = () => {
    if (pendingProgrammaticBacks > 0) {
      // هذا رجوع برمجي نفّذناه نحن لإزالة الفخ — ليس طلب مستخدم.
      pendingProgrammaticBacks -= 1;
      return;
    }
    // أي رجوع حقيقي من المستخدم يستهلك مدخل الفخ (ننتقل إلى المدخل السابق).
    armed = false;
    const closed = closeTopOverlay();
    if (!closed) return; // رجوع عادي داخل التطبيق: ندعه لمكتبة التوجيه
    // أُغلقت طبقة: نُعيد تسليح الفخ إن بقيت طبقات أخرى مفتوحة. أما إذا كانت
    // هذه آخر طبقة فلا نُسلّح شيئاً ولا نرجع خطوة إضافية (الرجوع استُهلك هنا).
    syncHistoryTrap(countOpenOverlays());
  };

  window.addEventListener('popstate', onPopState);
  installedCleanup = () => {
    window.removeEventListener('popstate', onPopState);
    installedCleanup = undefined;
  };
  return installedCleanup;
}

/** إعادة الحالة إلى الصفر — للاختبارات فقط. */
export function resetHistoryTrapForTests(): void {
  adapter = null;
  armed = false;
  pendingProgrammaticBacks = 0;
  installedCleanup?.();
  installedCleanup = undefined;
}
