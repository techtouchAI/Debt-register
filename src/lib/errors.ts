import { toast } from './toast'
import { isBenignLifecycleError } from './lifecycle'

/** رسالة موحّدة لأي خطأ إنجليزي لا نملك له ترجمة أدق. */
export const UNKNOWN_ERROR_MESSAGE = 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً'

type ErrorRecord = Record<string, unknown>

/**
 * رسائل الأخطاء التي تظهر عادةً من المتصفح أو IndexedDB أو طبقة الشبكة.
 * تُطبّق قبل القاعدة العامة حتى لا يرى المستخدم أي مصطلح تقني إنجليزي.
 */
const FRIENDLY_MESSAGES: ReadonlyArray<{ test: RegExp; message: string }> = [
  {
    test: /QuotaExceededError|quota|storage quota|disk full/i,
    message: 'مساحة التخزين ممتلئة. احذف بعض النسخ الاحتياطية أو بيانات المتصفح ثم أعد المحاولة.'
  },
  {
    test: /ConstraintError|unique constraint|duplicate|already exists/i,
    message: 'البيانات المكررة غير مسموحة (رقم أو اسم مستخدم مسجّل مسبقاً).'
  },
  { test: /DataError|invalid data/i, message: 'قيمة غير صالحة في أحد الحقول.' },
  {
    test: /NotFoundError|no such object store|one of the specified object stores was not found|\bnot found\b|\b404\b/i,
    message: 'العنصر أو بنية قاعدة البيانات غير موجودة.'
  },
  {
    test: /VersionError|version change|upgrade(?: needed|required| failed)?/i,
    message: 'تعذّر ترقية قاعدة البيانات. أغلق بقية نوافذ التطبيق وأعد تشغيله.'
  },
  {
    test: /InvalidAccessError|database(?: connection)? is closing|database is closed|DatabaseClosedError|invalid state/i,
    message: 'انقطع الاتصال بقاعدة البيانات. أعد تحميل الصفحة.'
  },
  {
    test: /TransactionInactiveError|TimeoutError|\btimeout\b|timed out|time limit/i,
    message: 'انتهت مهلة العملية. أعد المحاولة.'
  },
  {
    test: /NetworkError|network error|failed to fetch|fetch failed|offline|connection (?:lost|failed|refused)|ERR_NETWORK|ERR_INTERNET_DISCONNECTED/i,
    message: 'لا يوجد اتصال بالشبكة أو تعذّر إتمام العملية محلياً.'
  },
  { test: /unauthorized|\b401\b/i, message: 'غير مصرح لك بإجراء هذه العملية.' },
  { test: /forbidden|access denied|permission denied|\b403\b/i, message: 'لا تملك صلاحية تنفيذ هذه العملية.' },
  { test: /bad request|invalid request|\b400\b/i, message: 'الطلب غير صالح. راجع البيانات ثم أعد المحاولة.' },
  { test: /internal server error|server error|\b5\d{2}\b/i, message: 'حدث خطأ في الخادم. أعد المحاولة لاحقاً.' },
  { test: /cancelled|canceled|abort(?:ed)?/i, message: 'تم إلغاء العملية.' }
]

const BASIC_TRANSLATIONS: Readonly<Record<string, string>> = {
  error: 'خطأ',
  success: 'نجاح',
  warning: 'تنبيه',
  info: 'معلومات',
  ok: 'موافق',
  cancel: 'إلغاء',
  cancelled: 'تم إلغاء العملية',
  canceled: 'تم إلغاء العملية',
  timeout: 'انتهى وقت الاتصال',
  'network error': 'خطأ في الاتصال بالشبكة',
  'failed to fetch': 'تعذّر الاتصال بالشبكة',
  'not found': 'العنصر غير موجود',
  unauthorized: 'غير مصرح لك بإجراء هذه العملية',
  forbidden: 'لا تملك صلاحية تنفيذ هذه العملية'
}

/** استخراج رسالة مفيدة من Error أو DOMException أو كائن استجابة غير قياسي. */
function readErrorMessage(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value instanceof Error) return value.message || value.name

  if (value && typeof value === 'object' && depth < 3) {
    const record = value as ErrorRecord
    for (const key of ['message', 'error', 'reason', 'detail', 'description', 'statusText']) {
      const candidate = record[key]
      if (candidate === undefined || candidate === null) continue
      const message = readErrorMessage(candidate, depth + 1).trim()
      if (message) return message
    }

    if (typeof record.status === 'number' || typeof record.status === 'string') {
      return `HTTP ${String(record.status)}`
    }

    try {
      return JSON.stringify(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }

  return value == null ? '' : String(value)
}

function isAsciiEnglishText(value: string): boolean {
  return [...value].every((character) => character.charCodeAt(0) <= 0x7f) && /[A-Za-z]/.test(value)
}

const ENGLISH_ERROR_HINTS = /\b(?:error|exception|failed?|failure|timeout|timed out|network|fetch|unable|cannot|could not|not found|invalid|denied|forbidden|unauthorized|unavailable|quota|offline|cancel(?:led|ed)?)\b/i

/**
 * هل يبدو النص رسالة خطأ إنجليزية؟ تستعملها طبقة التوست حتى تترجم الأخطاء
 * القادمة من الخدمات، مع إبقاء أسماء الملفات أو أسماء العملاء الإنجليزية كما
 * هي عندما تُعرض في رسالة نجاح.
 */
export function isLikelyEnglishError(value: unknown): boolean {
  const text = readErrorMessage(value).trim()
  return ENGLISH_ERROR_HINTS.test(text) || (isAsciiEnglishText(text) && /\b(?:unexpected|operation|request|problem|issue|please|retry|try again)\b/i.test(text))
}

/**
 * المهيّئ المركزي للرسائل الظاهرة للمستخدم.
 *
 * لا تعتمد هذه الدالة على `instanceof Error` فقط؛ أخطاء Dexie و WebView قد
 * تأتي من realm آخر أو ككائن يحوي `message`. لذلك تُستخرج الرسالة أولاً، ثم
 * تُترجم الأنماط المعروفة، ويُستبدل أي نص إنجليزي غير معروف برسالة عربية
 * عامة بدلاً من تسريبه إلى واجهة التطبيق.
 */
export function formatErrorMessage(error: unknown): string {
  const raw = readErrorMessage(error).trim()
  if (!raw) return UNKNOWN_ERROR_MESSAGE

  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const exactTranslation = BASIC_TRANSLATIONS[normalized]
  if (exactTranslation) return exactTranslation

  const matched = FRIENDLY_MESSAGES.find((entry) => entry.test.test(raw))
  if (matched) return matched.message

  if (normalized.includes('success')) return 'تمت العملية بنجاح'
  if (normalized.includes('cancel')) return 'تم إلغاء العملية'

  // إذا كانت الرسالة لاتينية بالكامل فهي رسالة تقنية/إنجليزية غير مترجمة.
  // إخفاؤها أفضل من عرض نص إنجليزي للمستخدم العربي.
  if (isAsciiEnglishText(raw)) return UNKNOWN_ERROR_MESSAGE

  // يغطي رسائل مختلطة مثل: "Error: تعذّر الحفظ" دون العبث بأسماء الملفات
  // أو البيانات العربية التي قد تحتوي على كلمات لاتينية عابرة.
  if (ENGLISH_ERROR_HINTS.test(raw)) return UNKNOWN_ERROR_MESSAGE

  return raw
}

/** اسم قديم مستخدم في أجزاء التطبيق — يبقى كواجهة توافقية للمهيّئ المركزي. */
export function getArabicErrorMessage(error: unknown): string {
  return formatErrorMessage(error)
}

export function describeError(error: unknown): string {
  return formatErrorMessage(error)
}

export function logError(scope: string, error: unknown): string {
  const message = describeError(error)
  console.error(`[${scope}]`, error)
  return message
}

/**
 * الأخطاء التي لا تُعرض للمستخدم:
 *   - إلغاء مقصود (انتهى عمر الشاشة، أُغلق التطبيق) — ليس عطلاً.
 *   - خطأ قاعدة بيانات وقع **بعد** بدء الإغلاق — أثر متأخر لعملية كانت جارية
 *     أثناء إغلاق النافذة أو إعادة التحميل، ولا معنى لإظهاره.
 * تُسجّل في الطرفية للتشخيص، ويُمنع منها التنبيه الأحمر فقط.
 */
function isSuppressedError(error: unknown): boolean {
  return isBenignLifecycleError(error)
}

/** تسجيل الخطأ وإظهاره للمستخدم، وإرجاع رسالة عربية جاهزة. */
export function reportError(scope: string, error: unknown, title = 'تعذّر إتمام العملية'): string {
  if (isSuppressedError(error)) {
    // لا تنبيه ولا أثر في الطرفية: هذا حدث متوقع (إغلاق التطبيق أو مغادرة
    // الشاشة) وليس عطلاً. طباعته كانت تملأ مخرجات الاختبارات وتشوّش تشخيص
    // الأعطال الحقيقية. (المهام الخلفية تستخدم `logBackgroundFailure`.)
    return ''
  }
  const message = logError(scope, error)
  toast.error(title, message)
  return message
}

/** تغليف دالة غير متزامنة بمعالجة أخطاء موحّدة. */
export async function guard<T>(scope: string, task: () => Promise<T>, title?: string): Promise<T | undefined> {
  try {
    return await task()
  } catch (error) {
    reportError(scope, error, title)
    return undefined
  }
}

let installed = false

/**
 * التقاط الأخطاء غير المعالجة على مستوى التطبيق:
 * يعرض رسالة واضحة بدل شاشة صامتة أو بيضاء.
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    // أخطاء تحميل الموارد (صورة/خط) لا تستدعي تنبيه المستخدم
    if ((event.target as HTMLElement | null)?.tagName && event.target !== (window as unknown as EventTarget)) return
    reportError('window.error', event.error ?? event.message, 'حدث خطأ في التطبيق')
  })

  window.addEventListener('unhandledrejection', (event) => {
    // فشل تسجيل عامل الخدمة (متصفح قديم أو غلاف أصلي) ليس عطلاً في التطبيق —
    // يُكتفى بتسجيله في الطرفية بدل إقلاق المستخدم بتنبيه أحمر.
    const reason = event.reason
    const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '')
    if (/ServiceWorker|service.worker|registerSW|sw\.js/i.test(text)) {
      console.warn('عامل الخدمة غير متوفر — سيكمل التطبيق العمل بشكل طبيعي.', reason)
      return
    }
    // العمليات الجارية أثناء إغلاق التطبيق/الشاشة ليست أخطاء تُعرض للمستخدم
    if (isSuppressedError(reason)) {
      console.warn('أُلغيت عملية غير متزامنة أثناء الإغلاق', reason)
      return
    }
    reportError('unhandledrejection', event.reason, 'تعذّر إتمام عملية في الخلفية')
  })

  window.addEventListener('online', () => toast.info('عاد الاتصال بالإنترنت'))
  window.addEventListener('offline', () => toast.info('انقطع الاتصال بالإنترنت', 'التطبيق يعمل بشكل كامل دون إنترنت'))
}
