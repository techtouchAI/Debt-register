import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, closeDatabase } from '@/lib/db';
import {
  OperationAbortedError,
  assertNotShuttingDown,
  beginShutdown,
  createAbortScope,
  endShutdown,
  isAbortError,
  isBenignLifecycleError,
  isDatabaseClosedError,
  isShuttingDown,
  linkAbort,
  logBackgroundFailure,
  onShutdown
} from '@/lib/lifecycle';
import { reportError } from '@/lib/errors';
import { resolveBackIntent } from '@/lib/backIntent';
import {
  installHistoryTrap,
  isTrapArmed,
  resetHistoryTrapForTests,
  setHistoryAdapterForTests,
  syncHistoryTrap
} from '@/lib/historyTrap';

/**
 * دورة حياة العمليات غير المتزامنة (بند التدقيق 4).
 *
 * الهدف المُختبَر: لا تظهر `DatabaseClosedError` بعد إغلاق القاعدة — لا في
 * الطرفية ولا في واجهة المستخدم — وأن تُصنَّف الأخطاء تصنيفاً صحيحاً بين
 * "إلغاء مقصود" و"عطل حقيقي".
 */

beforeEach(() => {
  resetHistoryTrapForTests();
});

describe('علامة الإغلاق', () => {
  it('ترفض أي استعلام جديد بعد الإغلاق وتُصنّفه خطأً متوقعاً (لا عطلاً)', async () => {
    await closeDatabase();
    expect(isShuttingDown()).toBe(true);

    let rejection: unknown;
    try {
      await db.materials.count();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeTruthy();
    expect(isDatabaseClosedError(rejection)).toBe(true);
    expect(isBenignLifecycleError(rejection)).toBe(true);

    // والفحص المباشر للنطاق يرمي خطأ إلغاء صريحاً بلا عطل
    expect(() => assertNotShuttingDown()).toThrow(OperationAbortedError);
  });

  it('لا يعرض رسالة ولا أثراً في الطرفية لخطأ وقع بعد الإغلاق', async () => {
    await closeDatabase();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let rejection: unknown;
    try {
      await db.invoices.toArray();
    } catch (error) {
      rejection = error;
    }

    const message = reportError('test.scope', rejection, 'تعذّر إتمام العملية');
    expect(message).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('لا يظهر أي تحذير أو خطأ في الطرفية لخطأ إغلاق متأخر', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await closeDatabase();
    let rejection: unknown;
    try {
      await db.customers.toArray();
    } catch (error) {
      rejection = error;
    }

    // هذا ما تفعله المهام الخلفية بعد نجاح العملية الأصلية
    logBackgroundFailure('تعذّر فحص المخزون:', rejection);
    expect(warn).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warn.mockRestore();
    errorSpy.mockRestore();
  });

  it('يعرض التحذير فقط للعطل الحقيقي', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logBackgroundFailure('تعذّر الحفظ:', new Error('انقطاع في التخزين'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('يصنّف أخطاء Dexie المغلقة كأخطاء متوقعة', () => {
    const closed = new Error('Database has been closed');
    closed.name = 'DatabaseClosedError';
    expect(isDatabaseClosedError(closed)).toBe(true);
    expect(isDatabaseClosedError(new Error('boom'))).toBe(false);
    expect(isDatabaseClosedError(null)).toBe(false);
    expect(isDatabaseClosedError({ name: 'InvalidStateError' })).toBe(true);
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('عادي'))).toBe(false);
  });

  it('يُنفّذ مستمعي الإغلاق مرة واحدة فقط', () => {
    const listener = vi.fn();
    const off = onShutdown(listener);
    beginShutdown('test');
    beginShutdown('test-again');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    endShutdown();
    expect(isShuttingDown()).toBe(false);
  });

  it('لا يسجّل مستمعاً جديداً إذا كان الإغلاق قد بدأ', () => {
    beginShutdown('test');
    const listener = vi.fn();
    onShutdown(listener);
    expect(listener).toHaveBeenCalledWith('already-shutting-down');
    endShutdown();
  });
});

describe('نطاقات الإلغاء', () => {
  it('يوقف العملية عند إلغاء النطاق ويرمي خطأ إلغاء', async () => {
    const scope = createAbortScope('unmounted');
    const steps: string[] = [];

    const running = scope.run(async () => {
      steps.push('step-1');
      scope.abort('unmounted');
      scope.throwIfAborted();
      steps.push('step-2');
    });

    await expect(running).rejects.toBeInstanceOf(OperationAbortedError);
    expect(steps).toEqual(['step-1']);
  });

  it('runQuiet يبتلع الإلغاء ولا يعيد قيمة', async () => {
    const scope = createAbortScope();
    scope.abort('cancelled');
    await expect(scope.runQuiet(async () => 'never')).resolves.toBeUndefined();
  });

  it('runQuiet يعيد القيمة عند النجاح ويمرّر العطل الحقيقي', async () => {
    const scope = createAbortScope();
    await expect(scope.runQuiet(async () => 42)).resolves.toBe(42);
    await expect(scope.runQuiet(async () => { throw new Error('عطل حقيقي'); })).rejects.toThrow('عطل حقيقي');
  });

  it('يربط النطاق بمصدر إلغاء خارجي مرة واحدة', () => {
    const controller = new AbortController();
    const scope = createAbortScope();
    const unlink = linkAbort(controller.signal, scope, 'shutdown');

    controller.abort();
    expect(scope.aborted).toBe(true);
    unlink();
    expect(scope.signal.aborted).toBe(true);
  });
});

describe('فخّ سجل الرجوع', () => {
  /** محوّل سجل وهمي يسجّل كل ما يحدث فعلياً. */
  function fakeHistory() {
    const pushed: unknown[] = [];
    let backCalls = 0;
    let currentState: unknown = null;
    const adapter = {
      pushState: (state: unknown) => {
        pushed.push(state);
        currentState = state;
      },
      back: () => {
        backCalls += 1;
      },
      /** محاكاة وصول الرجوع إلى مدخل معيّن (كما يفعل المتصفح قبل إطلاق popstate). */
      landOn(state: unknown) {
        currentState = state;
      },
      get state() {
        return currentState;
      },
      href: 'https://example.test/#/customers'
    };
    return { adapter, pushed, get backCalls() { return backCalls; } };
  }

  it('يُسلَّح مدخل واحد فقط ما دامت الطبقة مفتوحة', () => {
    const history = fakeHistory();
    setHistoryAdapterForTests(history.adapter);

    syncHistoryTrap(1);
    expect(isTrapArmed()).toBe(true);
    expect(history.pushed.length).toBe(1);

    // مزامنة متكررة بنفس عدد الطبقات لا تضيف مدخلاً ثانياً
    syncHistoryTrap(1);
    expect(history.pushed.length).toBe(1);

    // إغلاق الطبقة يزيل المدخل برجوع برمجي واحد
    syncHistoryTrap(0);
    expect(isTrapArmed()).toBe(false);
    expect(history.backCalls).toBe(1);

    resetHistoryTrapForTests();
  });

  it('لا يستهلك تنقّل المستخدم عند إزالة الفخ إن لم يعد المدخل الحالي', () => {
    const history = fakeHistory();
    setHistoryAdapterForTests(history.adapter);

    syncHistoryTrap(1);
    expect(history.pushed.length).toBe(1);

    // تنقّل جديد وقع فوق مدخل الفخ (نقرة رابط أثناء فتح الطبقة)
    history.adapter.pushState({ usr: 'new-route' });

    // إغلاق الطبقة بعد التنقل: لا رجوع برمجي هنا — الرجوع كان سيُلغي
    // تنقّل المستخدم الجديد (الخلل السابق في القائمة الجانبية)
    syncHistoryTrap(0);
    expect(isTrapArmed()).toBe(false);
    expect(history.backCalls).toBe(0);

    resetHistoryTrapForTests();
  });

  it('يتجاوز مدخل الفخّ القديم بصمت: كل ضغطة رجوع = شاشة واحدة', () => {
    const history = fakeHistory();
    setHistoryAdapterForTests(history.adapter);

    // لا طبقات مفتوحة في هذا السيناريو — إغلاق الطبقة العليا يعيد false
    const uninstall = installHistoryTrap(() => false, () => 0);

    // محاكاة: الرجوع وصل إلى مدخل فخّ قديم تُرك في مكانه بعد تنقّل جديد
    history.adapter.landOn({ usr: 'old-route', __agriOfficeOverlayTrap: true });
    window.dispatchEvent(new PopStateEvent('popstate'));

    // لا إغلاق (لا طبقات) ولا تجاهل — تجاوز برمجي واحد فقط يحافظ على
    // قاعدة "ضغطة رجوع واحدة = شاشة واحدة"
    expect(history.backCalls).toBe(1);
    expect(isTrapArmed()).toBe(false);

    uninstall();
    resetHistoryTrapForTests();
  });

  it('يستهلك الرجوع الحقيقي لغلق الطبقة، ويُعيد التسليح فقط إن بقيت طبقات', () => {
    const history = fakeHistory();
    setHistoryAdapterForTests(history.adapter);

    let closed = 0;
    let openOverlays = 1;
    const uninstall = installHistoryTrap(
      () => {
        closed += 1;
        return true;
      },
      () => openOverlays
    );

    syncHistoryTrap(1);
    expect(history.pushed.length).toBe(1);

    // الرجوع الحقيقي يصل إلى المدخل الذي تحت الفخ (ليس مدخل فخّ)
    history.adapter.landOn({ usr: 'route-under-trap' });
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closed).toBe(1);
    // طبقة أخرى ما زالت مفتوحة ⇒ أُعيد تسليح الفخ بمدخل جديد
    expect(history.pushed.length).toBe(2);
    expect(isTrapArmed()).toBe(true);

    // آخر طبقة: لا إعادة تسليح ولا رجوع إضافي يستهلك ضغطة المستخدم
    openOverlays = 0;
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closed).toBe(2);
    expect(history.pushed.length).toBe(2);
    expect(isTrapArmed()).toBe(false);

    uninstall();
    resetHistoryTrapForTests();
  });

  it('لا يتدخل في الرجوع العادي داخل التطبيق (لا طبقات مفتوحة)', () => {
    const history = fakeHistory();
    setHistoryAdapterForTests(history.adapter);

    let closed = 0;
    const uninstall = installHistoryTrap(
      () => {
        closed += 1;
        return false;
      },
      () => 0
    );

    // رجوع عادي إلى مدخل مسار حقيقي (لا علامة فخّ عليه)
    history.adapter.landOn({ usr: 'real-route' });
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(closed).toBe(1);
    expect(history.backCalls).toBe(0);
    expect(isTrapArmed()).toBe(false);

    uninstall();
    resetHistoryTrapForTests();
  });
});

describe('قرار زر الرجوع', () => {
  it('يغلق الطبقة أولاً، ثم يرجع في السجل، ثم يطلب تأكيد الخروج في الرئيسية', () => {
    expect(resolveBackIntent({ hasOpenOverlay: true, pathname: '/materials' })).toEqual({ action: 'close-overlay' });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/materials' })).toEqual({ action: 'navigate-back' });
    // في الرئيسية بلا سجل: لا خروج صامتاً — حوار تأكيد صريح
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/' })).toEqual({ action: 'confirm-exit' });
    // من الرئيسية مع وجود سجل سابق: رجوع بدل خروج من التطبيق
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/', canGoBackInHistory: true })).toEqual({
      action: 'navigate-back'
    });
  });
});
