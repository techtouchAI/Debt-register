/**
 * تحليل نص الأرقام كما يكتبه المستخدم فعلاً (بلا مكوّنات React، قابل للاختبار).
 *
 * لماذا لا نستخدم `<input type="number">` مع `Number(e.target.value)`؟
 *   - مسح الحقل يُنتج `Number('') === 0` فيعود الصفر فوراً: لا يمكن تفريغ الحقل
 *     ولا تحديد الرقم والكتابة فوقه بشكل طبيعي (يظهر "05" أو يرجع "0").
 *   - الحقل الرقمي في Chromium يرفض الأرقام العربية-الهندية (٠-٩) بصمت:
 *     المستخدم يكتب ولا يظهر شيء.
 *   - `type=number` لا يدعم واجهات التحديد (selectionStart) فيقفز المؤشر.
 *
 * الحل: حقل نصي بـ `inputMode="decimal"` (لوحة أرقام على الجوال) + تحليل
 * متسامح هنا، مع إبقاء النص الذي يكتبه المستخدم كما هو حتى يكتمل.
 */

import { latinDigitOf } from './digits';

export interface NumberTextOptions {
  /** السماح بالكسور العشرية (افتراضي: نعم). */
  allowDecimal?: boolean;
}

/**
 * تنظيف النص المكتوب: أرقام لاتينية + فاصلة عشرية واحدة فقط.
 * - الأرقام العربية/الفارسية ⇒ لاتينية (تحويل حرف بحرف، فلا يتغيّر الطول).
 * - الفاصلة العشرية العربية `٫` والفاصلة `,` ⇒ `.`.
 * - فاصل الآلاف العربي `٬` والمسافات وأي رمز آخر ⇒ تُحذف.
 */
export function sanitizeNumberText(raw: string, options: NumberTextOptions = {}): string {
  const allowDecimal = options.allowDecimal !== false;
  let result = '';
  let seenDot = false;
  for (const char of raw) {
    const latin = char >= '0' && char <= '9' ? char : latinDigitOf(char);
    if (latin !== null) {
      result += latin;
    } else if (allowDecimal && (char === '.' || char === ',' || char === '٫') && !seenDot) {
      seenDot = true;
      result += '.';
    }
  }
  return result;
}

/** قيمة النص: رقم منتهٍ أو `null` (فارغ أو غير مكتمل مثل "."). */
export function parseNumberText(text: string): number | null {
  if (!text || text === '.') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** عرض القيمة كنص قابل للتحرير (بلا فواصل آلاف ولا صيغة علمية). */
export function formatNumberText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  // toLocaleString('en-US') بلا تجميع يمنع الصيغة العلمية للأرقام الكبيرة
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** هل يمثّل النص نفس القيمة؟ (لا نستبدل "5." أو "05" بينما القيمة 5) */
export function textMatchesValue(text: string, value: number | null | undefined): boolean {
  const parsed = parseNumberText(text);
  const normalized = value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
  return parsed === normalized;
}

/**
 * موضع المؤشر بعد التنظيف: عدد الأحرف المقبولة قبل موضع المؤشر الأصلي.
 * بهذا لا يقفز المؤشر إلى نهاية الحقل عند كتابة رقم عربي في منتصف النص.
 */
export function caretAfterSanitize(raw: string, caret: number, options: NumberTextOptions = {}): number {
  return sanitizeNumberText(raw.slice(0, caret), options).length;
}
