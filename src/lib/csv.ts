/**
 * ملفات الجداول (CSV) للتقارير المصدَّرة.
 *
 * لماذا CSV بعناوين عربية بدل JSON؟ ملف JSON لا يفتحه صاحب المكتب إلا ببرنامج
 * تقني، ومفاتيحه إنجليزية (totalDebt, debtors...). ملف الجدول يُفتح مباشرة في
 * إكسل أو جداول جوجل أو WPS على الهاتف، وكل عناوينه عربية.
 *
 * - ترميز UTF-8 مع علامة BOM في البداية: بدونها يعرض إكسل العربية رموزاً.
 * - الحقول التي فيها فاصلة أو علامة اقتباس أو سطر جديد تُحاط بعلامات اقتباس
 *   وتُضاعف علاماتها الداخلية (معيار RFC 4180)، ونهاية السطر CRLF.
 * - حماية من "حقن الصيغ": نص يبدأ بـ = + - @ يُسبق بعلامة ' حتى لا ينفّذه
 *   برنامج الجداول كصيغة (أسماء الزبائن والملاحظات نص يُدخله المستخدم).
 */
export type CsvCell = string | number | null | undefined;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function formatCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  let text = String(cell);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** بناء نص CSV جاهز للحفظ (مع BOM). */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(formatCell).join(',')).join('\r\n')}\r\n`;
}
