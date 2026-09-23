import { toast } from './toast'
import { isBenignLifecycleError } from './lifecycle'

/**
 * معالجة مركزية للأخطاء.
 *
 * المشكلة السابقة: معظم استدعاءات قاعدة البيانات داخل useEffect لم تكن
 * محاطة بـ try/catch، فكان أي فشل (امتلاء التخزين، قاعدة مقفلة، نسخة ترقية
 * فاشلة) يظهر كـ unhandled rejection في الطرفية بينما تبقى الواجهة فارغة
 * بلا أي رسالة للمستخدم.
 */

const FRIENDLY_MESSAGES: { test: RegExp | ((error: Error) => boolean); message: string }[] = [
  { test: /QuotaExceededError|quota/i, message: 'مساحة التخزين ممتلئة. احذف بعض النسخ الاحتياطية أو بيانات المتصفح ثم أعد المحاولة.' },
  { test: /ConstraintError/i, message: 'البيانات المكررة غير مسموحة (رقم أو اسم مستخدم مسجّل مسبقاً).' },
  { test: /DataError/i, message: 'قيمة غير صالحة في أحد الحقول.' },
  { test: /NotFoundError|no such object store|One of the specified object stores was not found/i, message: 'بنية قاعدة البيانات غير مكتملة. أعد تحميل التطبيق ليتم تحديثها.' },
  { test: /VersionError|upgrade/i, message: 'تعذّر ترقية قاعدة البيانات. أغلق بقية نوافذ التطبيق وأعد تشغيله.' },
  { test: /InvalidAccessError|The database connection is closing|database is closed/i, message: 'انقطع الاتصال بقاعدة البيانات. أعد تحميل الصفحة.' },
  { test: /TransactionInactiveError|TimeoutError/i, message: 'انتهت مهلة العملية. أعد المحاولة.' },
  { test: /NetworkError|Failed to fetch/i, message: 'تعذّر إتمام العملية. التطبيق يعمل دون إنترنت، تحقق من التخزين المحلي.' }
]

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const matched = FRIENDLY_MESSAGES.find((entry) =>
      typeof entry.test === 'function' ? entry.test(error) : entry.test.test(`${error.name} ${error.message}`)
    )
    if (matched) return matched.message
    return error.message || 'حدث خطأ غير متوقع'
  }
  if (typeof error === 'string' && error.trim()) return error
  return 'حدث خطأ غير متوقع'
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
 * تُسجَّل في الطرفية للتشخيص، ويُمنع منها التنبيه الأحمر فقط.
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
