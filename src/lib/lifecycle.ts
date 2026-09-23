/**
 * دورة حياة التطبيق وقابلية إلغاء العمليات غير المتزامنة.
 *
 * المشكلة التي تحلّها هذه الوحدة:
 *   كانت عمليات قاعدة البيانات تُبدأ ثم يستمر تنفيذها بعد إغلاق قاعدة
 *   البيانات (إغلاق النافذة، إعادة التحميل، أو إلغاء تركيب مكوّن في
 *   الاختبارات) فتظهر أخطاء `DatabaseClosedError` من دوال متأخرة لا يعنيه
 *   المستخدم أي شيء عنها، وقد تنتهي بتحديث واجهة لم تعد موجودة.
 *
 * الحل المكوَّن من ثلاث طبقات:
 *   1) علامة إغلاق واحدة (`beginShutdown`) تُرفع قبل إغلاق قاعدة البيانات،
 *      ويحرس عليها الوسيط (middleware) في `db.ts` فيمنع أي استعلام جديد.
 *   2) نطاقات إلغاء (`createAbortScope`) لكل مكوّن تُلغى عند إلغاء تركيبه،
 *      فتُوقف العمليات الطويلة (حفظ، تصدير، تقارير) في منتصفها.
 *   3) تصنيف الأخطاء: `isAbortError` / `isDatabaseClosedError` يُستخدمان في
 *      `errors.ts` لتمييز الخطأ المتوقع أثناء الإغلاق عن العطل الحقيقي.
 */

export type AbortReason = 'shutdown' | 'unmounted' | 'cancelled';

/** خطأ مقصود (ليس عطلاً): العملية أُلغيت لأن نطاقها انتهى أو أُغلق التطبيق. */
export class OperationAbortedError extends Error {
  readonly reason: AbortReason;

  constructor(reason: AbortReason = 'cancelled', message?: string) {
    super(message ?? defaultAbortMessage(reason));
    this.name = 'OperationAbortedError';
    this.reason = reason;
  }
}

function defaultAbortMessage(reason: AbortReason): string {
  switch (reason) {
    case 'shutdown':
      return 'أُلغيت العملية: التطبيق أو قاعدة البيانات قيد الإغلاق';
    case 'unmounted':
      return 'أُلغيت العملية: انتهى عمر الشاشة التي بدأتها';
    default:
      return 'أُلغيت العملية';

  }
}

/** هل الخطأ ناتج عن إلغاء مقصود (وليس عطلاً)؟ */
export function isAbortError(error: unknown): boolean {
  if (error instanceof OperationAbortedError) return true;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * هل الخطأ ناتج عن إغلاق قاعدة البيانات؟
 * Dexie يرمي `DatabaseClosedError` / `DatabaseClosedError` مع `InvalidStateError`
 * عند الوصول إلى قاعدة أُغلقت للتو — وهو سلوك متوقع عند الإغلاق لا خلل.
 */
export function isDatabaseClosedError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  if (name === 'DatabaseClosedError' || name === 'InvalidStateError') return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /DatabaseClosedError|Database has been closed|The database connection is closing|TransactionInactiveError/i.test(
    text
  );
}

/**
 * هل هذا خطأ "مؤجل/متوقع" يجب ألا يُقلق المستخدم؟
 * يُستخدم عند اتخاذ قرار عرض الرسالة: الإلغاء الناتج عن الإغلاق أو انتهاء
 * عمر الشاشة يُسجَّل في الطرفية فقط، أما العطل الحقيقي فيُعرض للمستخدم.
 */
export function isBenignLifecycleError(error: unknown): boolean {
  if (isAbortError(error)) return true;
  if (isShuttingDown()) return isDatabaseClosedError(error);
  return false;
}

/* ------------------------------------------------------------------ *
 * علامة الإغلاق
 * ------------------------------------------------------------------ */

let shuttingDown = false;
const shutdownListeners = new Set<(reason: string) => void>();

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** تسجيل مستمع يُنفَّذ مرة واحدة عند بدء الإغلاق (تنظيف، حفظ أخير، ...). */
export function onShutdown(listener: (reason: string) => void): () => void {
  if (shuttingDown) {
    listener('already-shutting-down');
    return () => undefined;
  }
  shutdownListeners.add(listener);
  return () => shutdownListeners.delete(listener);
}

/**
 * بدء الإغلاق: تُمنع كل عمليات قاعدة البيانات الجديدة بعد هذا النداء.
 * idempotent — الاستدعاء المتكرر لا يكرر المستمعين.
 */
export function beginShutdown(reason = 'app-close'): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const listener of [...shutdownListeners]) {
    try {
      listener(reason);
    } catch (error) {
      console.warn('تعذّر تنفيذ مستمع الإغلاق:', error);
    }
  }
  shutdownListeners.clear();
}

/** إعادة الأوضاع الطبيعية (تُستخدم عند إعادة فتح قاعدة البيانات في الاختبارات). */
export function endShutdown(): void {
  shuttingDown = false;
}

/** يرمي خطأ إلغاء إذا كان التطبيق قيد الإغلاق. */
export function assertNotShuttingDown(): void {
  if (shuttingDown) throw new OperationAbortedError('shutdown');
}

/* ------------------------------------------------------------------ *
 * نطاقات الإلغاء
 * ------------------------------------------------------------------ */

export interface AbortScope {
  readonly signal: AbortSignal;
  readonly aborted: boolean;
  abort(reason?: AbortReason): void;
  /** يرمي إذا أُلغي النطاق (أو أُغلق التطبيق). */
  throwIfAborted(): void;
  /** ينفّذ مهمة ويرمي `OperationAbortedError` عند الإلغاء. */
  run<T>(task: (signal: AbortSignal) => Promise<T> | T): Promise<T>;
  /** مثل `run` لكنه يُعيد `undefined` عند الإلغاء بدل رمي خطأ. */
  runQuiet<T>(task: (signal: AbortSignal) => Promise<T> | T): Promise<T | undefined>;
}

/** إنشاء نطاق قابل للإلغاء يستخدم `AbortController` القياسي. */
export function createAbortScope(reason: AbortReason = 'unmounted'): AbortScope {
  const controller = new AbortController();
  let abortReason: AbortReason = reason;

  const scope: AbortScope = {
    signal: controller.signal,
    get aborted() {
      return controller.signal.aborted;
    },
    abort(nextReason?: AbortReason) {
      if (nextReason) abortReason = nextReason;
      if (!controller.signal.aborted) controller.abort(new OperationAbortedError(abortReason));
    },
    throwIfAborted() {
      assertNotShuttingDown();
      if (controller.signal.aborted) throw new OperationAbortedError(abortReason);
    },
    async run<T>(task: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
      scope.throwIfAborted();
      const result = await task(controller.signal);
      scope.throwIfAborted();
      return result;
    },
    async runQuiet<T>(task: (signal: AbortSignal) => Promise<T> | T): Promise<T | undefined> {
      try {
        return await scope.run(task);
      } catch (error) {
        if (isAbortError(error) || isDatabaseClosedError(error)) return undefined;
        throw error;
      }
    }
  };

  return scope;
}

/**
 * ربط كائن قابل للإلغاء بنطاق: يحوّل أي حدث إلغاء إلى `abort` للنطاق.
 * يُستخدم للأحداث الأصلية (زر الرجوع، إغلاق النافذة) بدل تعليق مستمعين
 * متعددين بلا تنظيف.
 */
export function linkAbort(source: AbortSignal, scope: AbortScope, reason: AbortReason = 'cancelled'): () => void {
  if (source.aborted) {
    scope.abort(reason);
    return () => undefined;
  }
  const listener = () => scope.abort(reason);
  source.addEventListener('abort', listener, { once: true });
  return () => source.removeEventListener('abort', listener);
}
