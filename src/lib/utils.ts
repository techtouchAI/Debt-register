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
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
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

export function calculateProfit(salePrice: number, purchasePrice: number | undefined, quantity: number): number {
  if (!Number.isFinite(purchasePrice as number) || (purchasePrice as number) <= 0) return 0
  return roundMoney((salePrice - (purchasePrice as number)) * quantity)
}

export function getStockStatus(quantity: number, minQuantity: number): 'out' | 'low' | 'normal' {
  const qty = toFiniteNumber(quantity)
  const min = toFiniteNumber(minQuantity)
  if (qty <= 0) return 'out'
  if (min > 0 && qty <= min) return 'low'
  return 'normal'
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
 * تنظيف اسم الملف: يُبقي الحروف (بما فيها العربية) والأرقام والمسافة و . _ -
 * فقط، فلا يمكن تمرير مسارات (../../) أو أحرف تحكم عبر اسم المكتب أو اسم الملف.
 */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = String(name ?? '')
    .replace(/[^0-9A-Za-z\u0600-\u06FF\s._-]+/g, '_')
    .replace(/\.+/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .slice(0, 120)
  return cleaned || fallback
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
