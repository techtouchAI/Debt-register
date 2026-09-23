/**
 * اسم المكتب: قواعد التحقق والعرض.
 *
 * الاسم قيمة رسمية تُطبع في ترويسة كل فاتورة ووصل، ويُستخدم أيضاً في اسم
 * ملف النسخة الاحتياطية. لذلك:
 *   - يُحفظ كاملاً (لا اقتطاع ولا تنظيف يمسّ الأحرف العربية أو المسافات
 *     الداخلية) — يُزال الفراغ الخارجي فقط وتُحوَّل أسطر النص إلى مسافات
 *     لأن كسر السطر في اسم المكتب يُفسد الترويسة واسم الملف.
 *   - له حد أعلى واضح مع رسالة عربية، بدل قبول نص لا نهائي يكسر التخطيط.
 *   - يُعرض في الواجهة بلا اقتطاع، ويتغيّر حجم الخط فقط للأسماء الطويلة.
 */

/** الحد الأقصى المحفوظ في الإعدادات (150 حرفاً يكفي لأطول اسم مكتب حقيقي). */
export const MAX_OFFICE_NAME_LENGTH = 150;

/** الحد الذي نبدأ بعده بتصغير خط الترويسة حتى لا يخرج الاسم عن الإطار. */
export const OFFICE_NAME_COMPACT_LENGTH = 40;

/** الحد الذي نبدأ بعده بتصغير أكبر (يُستخدم في المطبوعات و PDF). */
export const OFFICE_NAME_TIGHT_LENGTH = 90;

export interface OfficeNameValidation {
  ok: boolean;
  /** الاسم بعد التطبيع (الفراغ الخارجي + الأسطر المتعددة). */
  value: string;
  error?: string;
}

/** تطبيع اسم المكتب: إزالة الفراغ الخارجي وتحويل أسطر النص إلى مسافات. */
export function normalizeOfficeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** التحقق من صحة اسم المكتب مع رسالة عربية واضحة. */
export function validateOfficeName(raw: unknown): OfficeNameValidation {
  const value = normalizeOfficeName(raw);
  if (!value) return { ok: false, value, error: 'اسم المكتب مطلوب' };
  if (value.length > MAX_OFFICE_NAME_LENGTH) {
    return {
      ok: false,
      value,
      error: `اسم المكتب طويل جداً: ${value.length} حرفاً (الحد ${MAX_OFFICE_NAME_LENGTH} حرفاً)`
    };
  }
  return { ok: true, value };
}

/**
 * أصناف CSS لعرض الاسم حسب طوله.
 * الغرض: لا يُقتطع الاسم أبداً، وإنما يصغر خطّه تدريجياً.
 */
export function officeNameLengthClass(name?: string | null): string {
  const length = normalizeOfficeName(name).length;
  if (length > OFFICE_NAME_TIGHT_LENGTH) return 'office-name-tight';
  if (length > OFFICE_NAME_COMPACT_LENGTH) return 'office-name-compact';
  return 'office-name-normal';
}

/**
 * حجم خط الترويسة في المستندات المطبوعة و PDF (بالنسبة للقالب).
 * يُستخدم في `print.ts` ليصغر الاسم الطويل بدل أن يخرج عن الصفحة.
 */
export function officeNameFontSize(name?: string | null): number {
  const length = normalizeOfficeName(name).length;
  if (length > OFFICE_NAME_TIGHT_LENGTH) return 16;
  if (length > OFFICE_NAME_COMPACT_LENGTH) return 19;
  return 22;
}
