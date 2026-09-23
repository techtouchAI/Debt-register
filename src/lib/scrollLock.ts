/**
 * قفل تمرير الخلفية (Body Scroll Lock) بعدّاد مراجع.
 *
 * المشكلة التي تحلّها هذه الوحدة:
 *   عند فتح طبقة عائمة (درج التنقل الجوال، النوافذ المنبثقة، المعاينات) يبقى
 *   محتوى الخلفية قابلاً للتمرير، فيتحرك ما خلف النافذة أثناء التمرير داخلها
 *   — وهي أحد الأعراض المُبلَّغ عنها في القائمة الجانبية. كذلك فإن تجاوز حدود
 *   منطقة التمرير داخل الطبقة كان "يُسلسل" التمرير إلى الخلفية (scroll chaining).
 *
 * الحل:
 *   قفل واحد مشترك بعدّاد مراجع: كل طبقة مفتوحة تستحوذ على القفل عند فتحها
 *   وتُحرّره عند إغلاقها. الخلفية لا تستعيد التمرير إلا بعد إغلاق **آخر**
 *   طبقة — فلا يتكرر خطأ "أول نافذة تُغلق تعيد التمرير للجميع" الذي يحدث مع
 *   ضبط `body.style.overflow` مباشرة في كل مكوّن.
 *
 * ملاحظة: منع تمرير الخلفية على اللمس داخل الطبقات نفسها يتم بـ
 * `overscroll-behavior: contain` على حاويات التمرير (انظر `Layout` والنوافذ)،
 * وهما معاً الحل القياسي المعتمد في مكتبات الواجهات الحديثة.
 */

let lockCount = 0;
let savedOverflow = '';

/** هل الخلفية مقفولة حالياً (توجد طبقة واحدة على الأقل مفتوحة)؟ */
export function isBodyScrollLocked(): boolean {
  return lockCount > 0;
}

/** عدد الطبقات المستحوذة على القفل حالياً — للتشخيص والاختبارات. */
export function bodyScrollLockCount(): number {
  return lockCount;
}

/**
 * الاستحواذ على القفل. يُعيد دالة تحرير يجب استدعاؤها عند إغلاق الطبقة
 * (وفي تنظيف `useEffect` حتى لا يعلق القفل بعد إلغاء تركيب مكوّن).
 */
export function acquireBodyScrollLock(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  lockCount += 1;
  if (lockCount === 1) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseBodyScrollLock();
  };
}

/** تحرير واحد للقفل — تُستدعى عادة عبر الدالة التي يُعيدها الاستحواذ. */
export function releaseBodyScrollLock(): void {
  if (typeof document === 'undefined' || lockCount === 0) return;

  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    savedOverflow = '';
  }
}

/** إعادة الوحدة إلى حالتها الأولى — للاختبارات فقط. */
export function resetBodyScrollLockForTests(): void {
  if (typeof document !== 'undefined' && lockCount > 0) {
    document.body.style.overflow = savedOverflow;
  }
  lockCount = 0;
  savedOverflow = '';
}
