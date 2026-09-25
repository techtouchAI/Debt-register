import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ------------------------------------------------------------------ *
 * الأرقام والمبالغ
 * ------------------------------------------------------------------ */

/**
 * تقريب المبلغ إلى خانتين عشريتين.
 * ضروري لأن حسابات الفواتير تجمع أرقاماً عشرية (0.1 + 0.2 ≠ 0.3 في JavaScript)
 * وبدون التقريب تتراكم فروق طفيفة تظهر في التقارير والأرصدة.
 */
export function roundMoney(value: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * تحويل أي قيمة إلى رقم صالح، وإرجاع قيمة بديلة عند الفشل.
 * null/undefined/النص الفارغ تُعامل كقيمة مفقودة (وليس صفراً) لأن
 * Number(null) === 0 في JavaScript وهذا يُخفي البيانات الناقصة.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'boolean') return fallback
  const n = typeof value === 'string' ? Number(value.trim() || NaN) : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * تحويل قيمة تاريخ إلى ISO بأمان.
 * لا ينبغي استدعاء Date#toISOString مباشرة من حقول الإدخال، لأن الحقل
 * يمكن أن يكون فارغاً أو غير مكتمل أثناء التحرير، وعندها يرمي المتصفح
 * RangeError ويبدو للمستخدم أن زر الحفظ لا يعمل.
 */
export function toISOStringOrNull(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/** هل القيمة رقماً موجباً (> 0)؟ */
export function isPositiveNumber(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

export function formatCurrency(amount: number, currency: string = 'د.ع'): string {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return `${safe.toLocaleString('ar-IQ')} ${currency ?? 'د.ع'}`
}

/* ------------------------------------------------------------------ *
 * التواريخ
 *
 * قاعدة مهمة: التخزين دائماً بصيغة ISO (UTC) لأنه ثابت ولا يتأثر بالمنطقة
 * الزمنية، أما العرض وحقول الإدخال (datetime-local / date) فيجب أن تكون
 * بالتوقيت المحلي. استخدام toISOString() لملء حقل datetime-local كان
 * يُزحزح التاريخ 3 ساعات في العراق وقد يُظهر اليوم السابق.
 * ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0')

/** تاريخ محلي بصيغة YYYY-MM-DD (مناسب لحقول type="date"). */
export function formatLocalDateInput(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** تاريخ ووقت محلي بصيغة YYYY-MM-DDTHH:mm (مناسب لحقول datetime-local). */
export function formatLocalDateTimeInput(date: Date = new Date()): string {
  return `${formatLocalDateInput(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * تحويل YYYY-MM-DD إلى تاريخ محلي (بداية اليوم محلياً).
 * ملاحظة: new Date('2026-09-19') تُقرأ كتوقيت UTC مما يُزحزح اليوم في
 * المناطق الموجبة، لذلك نُجزّئ النص يدوياً.
 */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  // Date يحوّل 2026-02-31 إلى تاريخ آخر بدلاً من اعتباره غير صالح؛
  // لا نسمح بهذا التحويل الصامت في التقارير أو البحث بالتاريخ.
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null
  return date
}

/** بداية اليوم محلياً. */
export function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/** نهاية اليوم محلياً (23:59:59.999). */
export function endOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export interface DayRangeISO {
  from: string
  to: string
}

/**
 * حساب نطاق يوم محلي كامل بصيغة ISO جاهزة للاستعلام في IndexedDB.
 * يُعيد null إذا كان أحد التاريخين غير صالح (يحمي من RangeError: Invalid time value).
 */
export function localDayRangeISO(fromDate: string, toDate: string): DayRangeISO | null {
  const from = parseLocalDate(fromDate)
  const to = parseLocalDate(toDate)
  if (!from || !to) return null
  const start = startOfDayLocal(from < to ? from : to)
  const end = endOfDayLocal(from < to ? to : from)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** هل يقع التاريخ (ISO) ضمن اليوم المحلي YYYY-MM-DD؟ */
export function isSameLocalDay(isoDate: string, localDay: string): boolean {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return false
  return formatLocalDateInput(date) === localDay
}

/** هل التاريخ صالح وقابل للعرض؟ */
export function isValidDate(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (typeof value !== 'string' && typeof value !== 'number') return false
  return !Number.isNaN(new Date(value).getTime())
}

export function formatDate(dateString: string, includeTime: boolean = false): string {
  if (!isValidDate(dateString)) return '—'
  const date = new Date(dateString)
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    calendar: 'gregory'
  }
  if (includeTime) {
    options.hour = '2-digit'
    options.minute = '2-digit'
  }
  return date.toLocaleDateString('ar-EG', options)
}

export function formatDateShort(dateString: string): string {
  if (!isValidDate(dateString)) return '—'
  return new Date(dateString).toLocaleDateString('ar-EG')
}

/**
 * تاريخ/وقت محلي بصيغة صالحة لحقول الإدخال.
 * يقبل تاريخاً مخزناً (ISO) أو Date، ويُعيد التاريخ الحالي إذا كانت القيمة غير صالحة.
 */
export function formatDateInput(value?: string | Date | null): string {
  const date = value ? new Date(value) : new Date()
  return formatLocalDateTimeInput(Number.isNaN(date.getTime()) ? new Date() : date)
}

/* ------------------------------------------------------------------ *
 * حالة المخزون
 * ------------------------------------------------------------------ */


export function getStockStatus(quantity: number, minQuantity: number): 'out' | 'low' | 'normal' {
  const qty = toFiniteNumber(quantity)
  const min = toFiniteNumber(minQuantity)
  if (qty <= 0) return 'out'
  if (min > 0 && qty <= min) return 'low'
  return 'normal'
}

/**
 * نفس قاعدة المخزون المستخدمة في الواجهة والتنبيهات والتقارير.
 * توحيدها يمنع أن يظهر الصنف منخفضاً في صفحة ولا يظهر في الجرس بسبب
 * استخدام حد المكتب في مسار وحدّ المادة في مسار آخر.
 */
export function isLowStock(quantity: number, minQuantity: number): boolean {
  return getStockStatus(quantity, minQuantity) !== 'normal'
}

export function getStockStatusColor(status: 'out' | 'low' | 'normal'): string {
  switch (status) {
    case 'out': return 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
    case 'low': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    default: return 'text-green-600 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
  }
}

export function getStockStatusText(status: 'out' | 'low' | 'normal'): string {
  switch (status) {
    case 'out': return 'نفد المخزون'
    case 'low': return 'مخزون منخفض'
    default: return 'متوفر'
  }
}

/* ------------------------------------------------------------------ *
 * أمان النصوص والملفات
 * ------------------------------------------------------------------ */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/**
 * تهريب النصوص قبل إدراجها في HTML مبني كنص.
 * أسماء الزبائن والمواد وملاحظات الفواتير تُدخل يدوياً وقد تأتي أيضاً من
 * ملف نسخة احتياطية مستورد، لذا يجب تهريبها لمنع تنفيذ أي شيفرة (XSS).
 */
export function escapeHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/**
 * عدد البايتات الفعلي للنص بترميز UTF-8.
 * مهم لأسماء الملفات: الحرف العربي بايتان، فحدّ "120 حرفاً" قد يصبح 240
 * بايت ويتجاوز حدود بعض الأنظمة (خاصة Windows في المسارات الطويلة).
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

/**
 * اقتطاع نص عند حدّ بايتات دون كسر محرف (code point) ودون ترك فواصل معلّقة
 * في النهاية — يُستخدم لأسماء الملفات فقط، ولا يُطبَّق أبداً على اسم المكتب
 * المحفوظ أو المعروض.
 */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const source = String(text ?? '')
  if (maxBytes <= 0) return ''
  if (utf8ByteLength(source) <= maxBytes) return source

  let result = ''
  let bytes = 0
  for (const char of source) {
    const size = utf8ByteLength(char)
    if (bytes + size > maxBytes) break
    result += char
    bytes += size
  }
  // لا نترك مسافة أو نقطة أو شرطة أو تشكيلاً عربياً معلقاً في نهاية الاسم
  // ‏ لا نترك مسافة/نقطة/شرطة أو علامات تشكيل عربية معلّقة في النهاية
  return result.replace(/[\s._\-\p{M}\u0640]+$/u, '')
}

/** الحد الافتراضي لطول اسم الملف بالبايت (آمن على Windows و Android و ext4). */
export const MAX_FILE_NAME_BYTES = 120

/**
 * تنظيف اسم الملف: يُبقي الحروف (بما فيها العربية) والأرقام والمسافة و . _ -
 * فقط، فلا يمكن تمرير مسارات (../../) أو أحرف تحكم عبر اسم المكتب أو اسم
 * الملف، ثم يقصّه عند حدّ البايتات بلا كسر للمحارف.
 */
export function sanitizeFileName(name: string, fallback = 'file', maxBytes = MAX_FILE_NAME_BYTES): string {
  const cleaned = String(name ?? '')
    // أحرف التحكم (قد تصل من نص ملصوق أو ملف مستورد) تُحوَّل لمسافة
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[^0-9A-Za-z\u0600-\u06FF\s._-]+/g, '_')
    .replace(/\.+/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
  const limited = truncateToUtf8Bytes(cleaned, maxBytes)
  return limited || fallback
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'))
    reader.readAsDataURL(file)
  })
}

export function debounce<T extends (...args: never[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: number | null = null
  return (...args: Parameters<T>) => {
    if (timeout) window.clearTimeout(timeout)
    timeout = window.setTimeout(() => func(...args), wait)
  }
}

/** معرّف فريد (بديل عن substr المهجور). */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
