/**
 * توحيد الأرقام التي يكتبها المستخدم.
 *
 * لوحة المفاتيح العربية في أندرويد تكتب الأرقام العربية-الهندية (٠-٩)
 * افتراضياً، والفارسية/الأردية تكتب (۰-۹). كل حقل يقبل أرقاماً (هاتف، مبالغ،
 * رمز دخول) يمرّ من هنا حتى تُقبل هذه الأرقام وتُحفظ بصيغة لاتينية موحّدة.
 */

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰ (فارسي/أردو)

/** رقم لاتيني مقابل حرف رقمي عربي/فارسي، أو `null` إن لم يكن الحرف رقماً منها. */
export function latinDigitOf(char: string): string | null {
  const code = char.charCodeAt(0);
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO);
  if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
    return String(code - EXTENDED_ARABIC_INDIC_ZERO);
  }
  return null;
}

/** تحويل الأرقام العربية-الهندية والفارسية في النص إلى أرقام لاتينية (حرفاً بحرف). */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => latinDigitOf(digit) as string);
}
