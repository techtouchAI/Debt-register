/**
 * مفاتيح جدول `meta` ومن منها ينتقل مع النسخة الاحتياطية.
 *
 * جدول meta يجمع نوعين من القيم:
 *   1. بيانات تخص **المكتب** ويجب أن تنتقل معه إلى أي جهاز (محمولة):
 *      - علامات تسلسل أرقام المستندات `seq:*` — بدونها تُعاد أرقام فواتير
 *        محذوفة بعد الاستعادة على جهاز جديد (رقم ورقي بيد زبون يتكرر).
 *      - بيانات الدخول `auth:*` (بصمة رمز استرداد المدير).
 *      - علامة اكتمال إعداد المكتب.
 *   2. أعلام صيانة تخص **هذا الجهاز** فقط (آخر تقليم للسجلات، إصدار
 *      المصالحة...) — لا معنى لنقلها وتُعاد حسابها تلقائياً.
 *
 * القائمة صريحة (allowlist) عمداً: أي مفتاح جديد لا ينتقل إلا إن أُضيف هنا
 * بقرار واعٍ، فلا تتسرّب حالة جهاز إلى جهاز آخر.
 */

export const SEQUENCE_META_PREFIX = 'seq:';
export const AUTH_META_PREFIX = 'auth:';
export const SETUP_COMPLETED_META_KEY = 'office-setup-completed';

/** هل ينتقل هذا المفتاح مع النسخة الاحتياطية؟ */
export function isPortableMetaKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key) return false;
  return key.startsWith(SEQUENCE_META_PREFIX) || key.startsWith(AUTH_META_PREFIX) || key === SETUP_COMPLETED_META_KEY;
}

/** هل المفتاح علامة تسلسل أرقام (تُدمج بأخذ القيمة الأكبر عند الاستعادة)؟ */
export function isSequenceMetaKey(key: string): boolean {
  return key.startsWith(SEQUENCE_META_PREFIX);
}
