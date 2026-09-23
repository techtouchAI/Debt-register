import type { OfficeSettings } from '@/types';

/**
 * مخزن إعدادات المكتب — مصدر واحد للقيمة المعروضة في التخطيط والصفحات.
 *
 * سبب وجوده: كان التخطيط يعتمد على `useLiveQuery` وحده لعرض اسم المكتب، ونتيجة
 * استعلام Dexie الحيّ قد تصل متأخرة أو لا تصل أبداً في بعض التفاعلات (تهيئة
 * التشغيل الأول ثم تركيب التخطيط مباشرة)، فيظهر الاسم الافتراضي "إعداد المكتب
 * مطلوب" رغم أن الاسم محفوظ في القاعدة. الاعتماد على توقيت الاستعلام الحيّ
 * كان يجعل الاختبار متذبذباً والواجهة أسوأ لحظةً بعد حفظ الإعدادات.
 *
 * الحل: قيمة واحدة في الذاكرة تُنشَر (publish) من كل مسار يقرأ الإعدادات أو
 * يكتبها، وتُقرأ في الواجهة بـ `useSyncExternalStore`:
 *   - `updateSettings` تنشر القيمة الجديدة فور نجاح الكتابة ⇒ الشاشة تتحدث
 *     فوراً بلا انتظار أي استعلام.
 *   - `getSettings` تنشر ما قرأته ⇒ أي شاشة تقرأ الإعدادات تُحدّث المخزن.
 *   - الاستيراد/الاستعادة/حذف البيانات الكامل تنشر القيمة الجديدة صراحةً.
 *
 * لا يعتمد هذا الملف على Dexie أو React، لذا يمكن اختباره مباشرة.
 */

let snapshot: OfficeSettings | null = null;
let seeded = false;

const listeners = new Set<() => void>();

/** تسجيل قارئ (تستخدمه `useSyncExternalStore`). */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** هل قُرئت الإعدادات مرة واحدة على الأقل في هذه الجلسة؟ */
export function isSettingsSeeded(): boolean {
  return seeded;
}

/** نشر قيمة جديدة (أو `null` بعد حذف الإعدادات) وإخطار القرّاء. */
export function publishSettings(next: OfficeSettings | null | undefined): void {
  const value = next ?? null;
  // لا نُرسل إشعاراً إذا لم تتغيّر القيمة فعلاً حتى لا نرسم الواجهة بلا داعٍ
  // (كل قراءة من القاعدة تُنتج كائناً جديداً).
  if (seeded && sameSettings(snapshot, value)) return;
  snapshot = value;
  seeded = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('تعذّر تحديث مستمع الإعدادات:', error);
    }
  }
}

/** القيمة الحالية (نفس المرجع حتى تتغيّر فعلاً — شرط `useSyncExternalStore`). */
export function readSettingsSnapshot(): OfficeSettings | null {
  return snapshot;
}

/** تصفير المخزن (يُستخدم بين الاختبارات وعند حذف كل البيانات). */
export function resetSettingsStore(): void {
  snapshot = null;
  seeded = false;
}

/** الحقول المعروضة من الإعدادات — تُقارن واحداً واحداً بأنواع آمنة. */
const COMPARED_FIELDS = [
  'id',
  'officeName',
  'phone',
  'address',
  'logo',
  'currency',
  'lowStockThreshold',
  'theme',
  'autoBackupEnabled',
  'autoBackupInterval',
  'lastBackup',
  'language',
  'invoiceFooter',
  'taxNumber'
] as const satisfies readonly (keyof OfficeSettings)[];

/** هل القيمتان متطابقتان في كل الحقول المعروضة؟ */
export function sameSettings(a: OfficeSettings | null, b: OfficeSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return COMPARED_FIELDS.every((field) => a[field] === b[field]);
}
