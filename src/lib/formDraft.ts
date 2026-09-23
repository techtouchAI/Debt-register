/**
 * مسودات النماذج غير المحفوظة.
 *
 * المشكلة: النص المكتوب في نموذج لم يُحفظ بعد يعيش في ذاكرة React فقط، فيضيع
 * بصمت عند:
 *   - مغادرة الصفحة من القائمة الجانبية قبل الضغط على "حفظ".
 *   - إعادة تحميل الواجهة (مثلاً بعد استعادة نسخة احتياطية أو تحديث PWA).
 *   - إنهاء أندرويد لعملية WebView في الخلفية حين يخرج المستخدم لنسخ رقم
 *     الهاتف من تطبيق آخر ثم يعود — فيبدأ التطبيق من جديد والحقول فارغة.
 *
 * الحل: حفظ المسودة في `localStorage` مع كل تعديل، واستعادتها عند العودة،
 * وحذفها فور نجاح الحفظ الحقيقي في قاعدة البيانات. الحقول الكبيرة (الشعار
 * base64) لا تدخل المسودة حتى لا تُستنزف حصة التخزين المحلي.
 */

const PREFIX = 'form-draft:';

interface DraftEnvelope<T> {
  v: 1;
  savedAt: string;
  data: T;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // وضع خاص/تخزين معطّل: المسودات ميزة إضافية لا شرط
  }
}

/** قراءة مسودة محفوظة (أو null إن لم توجد أو كانت تالفة). */
export function loadFormDraft<T extends object>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope<T>>;
    if (parsed?.v !== 1 || typeof parsed.data !== 'object' || parsed.data === null) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    store.removeItem(PREFIX + key);
    return null;
  }
}

/** حفظ المسودة (بلا رمي أخطاء: امتلاء التخزين لا يجب أن يعطّل الكتابة). */
export function saveFormDraft<T extends object>(key: string, data: T): void {
  const store = storage();
  if (!store) return;
  const envelope: DraftEnvelope<T> = { v: 1, savedAt: new Date().toISOString(), data };
  try {
    store.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch (error) {
    console.warn('تعذّر حفظ مسودة النموذج:', error);
  }
}

/** حذف المسودة بعد الحفظ الناجح أو التراجع عن التعديلات. */
export function clearFormDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* لا شيء */
  }
}
