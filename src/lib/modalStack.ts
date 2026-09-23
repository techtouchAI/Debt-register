/**
 * مكدس النوافذ والطبقات (Modals / Drawers / المعاينات).
 *
 * الهدف: سلوك موحّد ومتوقّع لكل طرق "الرجوع" مهما كانت المنصة:
 *   - زر الرجوع في أندرويد.
 *   - زر الفأرة الخلفي و Alt+← في Electron و Tauri والمتصفح.
 *   - الزر Escape على لوحة المفاتيح.
 *   - زر الإغلاق داخل النافذة.
 *
 * القواعد المعتمدة (نفس سلوك التطبيقات الأصلية):
 *   1. تُغلق النافذة المفتوحة أولاً، واحدة فقط عند كل طلب رجوع (LIFO).
 *   2. لا يُغلق Escape إلا الطبقة العليا القابلة للإغلاق بـ Escape.
 *   3. لا يخرج التطبيق من الصفحة الرئيسية إطلاقاً بسبب الرجوع.
 *
 * سابقاً كان كل مكوّن يسجّل مستمع `keydown` خاصاً به، فكان Escape مع
 * نافذتين مفتوحتين يُغلق الاثنتين معاً. الآن هناك مستمع واحد للمشروع كله
 * في هذه الوحدة، وهو ما يجعل السلوك قابلاً للاختبار بشكل حتمي.
 */

export interface ModalCloserOptions {
  /** هل يُسمح لزر Escape بإغلاق هذه الطبقة؟ (افتراضي: نعم) */
  escape?: boolean;
  /** وصف مختصر للطبقة (يُستخدم في السجلات والاختبارات). */
  label?: string;
  /** هل هذه الطبقة تمنع التنقل بالرجوع حتى بعد إغلاقها؟ (غير مستخدم حالياً) */
  keepHistoryTrap?: boolean;
}

interface ModalEntry {
  id: number;
  close: () => void;
  escape: boolean;
  label: string;
}

let nextId = 1;
const stack: ModalEntry[] = [];
const listeners = new Set<(entries: readonly ModalEntry[]) => void>();

let keydownInstalled = false;

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener(stack);
    } catch (error) {
      console.warn('تعذّر تحديث مستمع الطبقات:', error);
    }
  }
}

/** أيقونة احتياطية: نخفي محتوى الطبقات عن أدوات القراءة عند الحاجة لاحقاً. */
function findTopEscapeEntry(): ModalEntry | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].escape) return stack[index];
  }
  return undefined;
}

function installEscapeHandler(): void {
  if (keydownInstalled || typeof window === 'undefined') return;
  keydownInstalled = true;

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const entry = findTopEscapeEntry();
      if (!entry) return;
      // منع السلوك الافتراضي (إغلاق عناصر المتصفح الأصلية) وإيقاف انتشار
      // الحدث حتى لا تُغلق طبقتان معاً كما كان يحدث سابقاً.
      event.preventDefault();
      event.stopPropagation();
      closeEntry(entry.id);
    },
    true
  );
}

function closeEntry(id: number): boolean {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  const [entry] = stack.splice(index, 1);
  emit();
  try {
    entry.close();
  } catch (error) {
    console.warn('تعذّر إغلاق الطبقة:', error);
  }
  return true;
}

/**
 * تسجيل طبقة مفتوحة. يُعيد دالة إلغاء تسجيل يجب استدعاؤها عند الإغلاق
 * (وفي تنظيف `useEffect`) حتى يبقى المكدس مطابقاً لما هو معروض فعلاً.
 */
export function pushModalCloser(closer: () => void, options: ModalCloserOptions = {}): () => void {
  installEscapeHandler();
  const entry: ModalEntry = {
    id: nextId++,
    close: closer,
    escape: options.escape !== false,
    label: options.label ?? 'طبقة'
  };
  stack.push(entry);
  emit();

  return () => {
    const index = stack.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      stack.splice(index, 1);
      emit();
    }
  };
}

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

export function openModalCount(): number {
  return stack.length;
}

/** وصف الطبقة العليا — مفيد للتشخيص والاختبارات. */
export function topModalLabel(): string | undefined {
  return stack[stack.length - 1]?.label;
}

/** يُغلق أحدث طبقة. يُعيد true إذا وُجدت طبقة وأُغلقت. */
export function closeTopModal(): boolean {
  const entry = stack[stack.length - 1];
  if (!entry) return false;
  return closeEntry(entry.id);
}

/** يُغلق كل الطبقات بالترتيب (الأحدث أولاً). يُعيد عدد ما أُغلق. */
export function closeAllModals(): number {
  let closed = 0;
  while (stack.length > 0) {
    if (!closeTopModal()) break;
    closed += 1;
  }
  return closed;
}

/** اشتراك في تغيّر المكدس (يُستخدم للاختبارات ولإخفاء شريط التنقل). */
export function subscribeModalStack(listener: (entries: readonly ModalEntry[]) => void): () => void {
  listeners.add(listener);
  listener(stack);
  return () => {
    listeners.delete(listener);
  };
}

/** إعادة المكدس إلى الحالة الأولى — للاختبارات فقط. */
export function resetModalStackForTests(): void {
  stack.length = 0;
  nextId = 1;
  emit();
}
