import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { seedOfficeProfile } from './helpers';
import { endShutdown } from '@/lib/lifecycle';
import { setNativeBackSubscriber, type NativeBackEvent } from '@/lib/nativeBridge';
import { openModalCount, hasOpenModal } from '@/lib/modalStack';
import { isTrapArmed, resetHistoryTrapForTests, setHistoryAdapterForTests } from '@/lib/historyTrap';
import { resolveBackIntent } from '@/lib/backIntent';

/**
 * اختبار واجهة فعلي لسلوك الرجوع — أحد المتطلبات المتبقية في التدقيق.
 *
 * يُختبر هنا سلوك حقيقي عبر تركيب التطبيق كاملاً (Router + Layout + الصفحات):
 *   - زر الرجوع في أندرويد (يُضخّ عبر الجسر الأصلي).
 *   - الرجوع في السجل (زر الفأرة الخلفي / Alt+← في Electron و Tauri والمتصفح).
 *   - Escape مع أكثر من نافذة مفتوحة.
 *   - الرجوع في الصفحة الرئيسية يعرض حوار تأكيد الخروج (لا خروج بضغطة واحدة).
 *   - النقر داخل القائمة الجانبية يصل فعلاً إلى الصفحة المطلوبة.
 */

let lastBackListener: ((event: NativeBackEvent) => void) | null = null;
let removedSubscriptions = 0;

beforeEach(() => {
  cleanup();
  lastBackListener = null;
  removedSubscriptions = 0;
  window.location.hash = '#/';
  setNativeBackSubscriber((listener) => {
    lastBackListener = listener;
    return {
      remove: () => {
        removedSubscriptions += 1;
      }
    };
  });
});

/** تركيب التطبيق على مسار محدد والانتظار حتى تجاوز شاشة التحميل. */
async function bootApp(hash: string, officeName = 'مكتب الاختبار الزراعي') {
  await seedOfficeProfile(officeName);
  window.location.hash = hash;
  render(<App />);
  await waitFor(
    () => {
      expect(screen.queryByText('جاري تحميل بيانات المكتب…')).toBeNull();
    },
    { timeout: 5000 }
  );
  // انتظار تسجيل مستمع الرجوع الأصلي
  await waitFor(() => expect(lastBackListener).not.toBeNull(), { timeout: 5000 });
}

describe('منطق الرجوع المجرّد', () => {
  it('يغلق الطبقة أولاً ثم يرجع ثم يطلب تأكيد الخروج في الرئيسية', () => {
    expect(resolveBackIntent({ hasOpenOverlay: true, pathname: '/customers' })).toEqual({
      action: 'close-overlay'
    });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/customers', hasInAppHistory: true })).toEqual({
      action: 'navigate-back'
    });
    // بلا سجل (فتح مباشر/استعادة بعد إنهاء التطبيق): صعود للصفحة الأم
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/invoices/7/edit' })).toEqual({
      action: 'navigate-up',
      to: '/invoices/7'
    });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/customers' })).toEqual({
      action: 'navigate-up',
      to: '/'
    });
    // في الرئيسية: تأكيد صريح دائماً — حتى مع وجود سجل سابق، فالرئيسية
    // نهاية سلسلة الرجوع ولا نعود منها إلى صفحات قديمة
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/' })).toEqual({ action: 'confirm-exit' });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/', hasInAppHistory: true })).toEqual({
      action: 'confirm-exit'
    });
  });
});

describe('زر الرجوع في أندرويد (Capacitor)', () => {
  it('يُغلق النافذة المفتوحة أولاً ولا يغادر الصفحة', async () => {
    await bootApp('#/customers');
    fireEvent.click(screen.getByText('إضافة زبون جديد'));
    await waitFor(() => expect(screen.getByText('الاسم الكامل *')).toBeTruthy());
    expect(hasOpenModal()).toBe(true);

    const exitApp = vi.fn();
    act(() => lastBackListener?.({ canGoBack: false, exitApp }));

    await waitFor(() => expect(screen.queryByText('الاسم الكامل *')).toBeNull());
    expect(exitApp).not.toHaveBeenCalled();
    expect(openModalCount()).toBe(0);
    // ما زلنا في صفحة العملاء ولم يتغيّر المسار
    expect(screen.getByText('إدارة العملاء ومتابعة الديون')).toBeTruthy();
    expect(window.location.hash).toBe('#/customers');
  });

  it('يرجع شاشة واحدة عندما لا توجد نوافذ مفتوحة', async () => {
    await bootApp('#/customers');
    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));

    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy(), { timeout: 5000 });
  });

  it('لا يخرج التطبيق بضغطة واحدة من الصفحة الرئيسية (تظهر رسالة في الويب)', async () => {
    await bootApp('#/');
    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy());

    const exitApp = vi.fn();
    act(() => lastBackListener?.({ canGoBack: false, exitApp }));

    await waitFor(() => expect(screen.getByText('أنت في الصفحة الرئيسية')).toBeTruthy());
    expect(exitApp).not.toHaveBeenCalled();
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
    expect(screen.queryByText('الخروج من التطبيق؟')).toBeNull();
  });

  it('يُزيل مستمع الرجوع عند إلغاء تركيب التطبيق (لا تسريب مستمعين)', async () => {
    await bootApp('#/');
    cleanup();
    await waitFor(() => expect(removedSubscriptions).toBeGreaterThan(0));
  });
});

describe('الرجوع في المتصفح و Electron و Tauri (حدث السجل)', () => {
  it('يغلق النافذة المفتوحة ولا يتغيّر المسار عند ضغط زر الرجوع', async () => {
    await bootApp('#/payments');
    fireEvent.click(screen.getByText('تسديد دين جديد'));
    await waitFor(() => expect(hasOpenModal()).toBe(true));
    expect(isTrapArmed()).toBe(true); // مدخل الفخ مُسلَّح ما دامت النافذة مفتوحة

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(hasOpenModal()).toBe(false));
    // المسار لم يتغيّر: الرجوع استُهلك في إغلاق النافذة
    expect(window.location.hash).toBe('#/payments');
    expect(isTrapArmed()).toBe(false);
  });

  it('لا يتدخّل في الرجوع العادي عندما لا توجد نوافذ مفتوحة', async () => {
    await bootApp('#/customers');
    const pushState = vi.spyOn(window.history, 'pushState');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(hasOpenModal()).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('يُزيل مدخل الفخ عند إغلاق النافذة بزر الإغلاق', async () => {
    const backCalls: number[] = [];
    setHistoryAdapterForTests({
      pushState: () => undefined,
      back: () => backCalls.push(Date.now()),
      state: { __agriOfficeOverlayTrap: true },
      href: 'http://localhost/#/customers'
    });

    await bootApp('#/customers');
    fireEvent.click(screen.getByText('إضافة زبون جديد'));
    await waitFor(() => expect(hasOpenModal()).toBe(true));

    fireEvent.click(screen.getByText('إلغاء'));
    await waitFor(() => expect(hasOpenModal()).toBe(false));
    // أُزيل مدخل سجل إضافي واحد حتى لا يفقد المستخدم ضغطة رجوع لاحقة
    expect(backCalls.length).toBe(1);
    resetHistoryTrapForTests();
  });
});

describe('القائمة الجانبية (الدرج الجوال)', () => {
  it('النقر على رابط داخل الدرج المفتوح ينقل فعلاً إلى الصفحة المطلوبة', async () => {
    await bootApp('#/customers');
    fireEvent.click(screen.getByLabelText('فتح قائمة التنقل'));
    await waitFor(() => expect(hasOpenModal()).toBe(true));

    fireEvent.click(screen.getByText('لوحة التحكم'));

    // التنقل يجب أن يصل: لا رجوع خفي يُلغي نقرة المستخدم
    await waitFor(() => expect(window.location.hash).toBe('#/'), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy());
    expect(hasOpenModal()).toBe(false);
  });

  it('بعد التنقل من الدرج: التنقّل يصل، والدرج يُغلق، ولا ضغطات رجوع ميتة', async () => {
    await bootApp('#/');
    fireEvent.click(screen.getByLabelText('فتح قائمة التنقل'));
    fireEvent.click(screen.getByText('العملاء', { selector: 'nav *' }));
    await waitFor(() => expect(window.location.hash).toBe('#/customers'), { timeout: 2000 });
    await waitFor(() => expect(hasOpenModal()).toBe(false));

    act(() => {
      lastBackListener?.({ canGoBack: true, exitApp: vi.fn() });
    });

    // شاشة واحدة بالضبط — لا ضغطة ميتة على مدخل الفخ ولا قفزة مزدوجة
    await waitFor(() => expect(window.location.hash).toBe('#/'), { timeout: 2000 });
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
  });

  it('الدرج الجانبي في الجوال يُغلق بزر الرجوع', async () => {
    await bootApp('#/');
    const menuButton = screen.getByLabelText('فتح قائمة التنقل');
    fireEvent.click(menuButton);
    await waitFor(() => expect(hasOpenModal()).toBe(true));

    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));
    await waitFor(() => expect(hasOpenModal()).toBe(false));
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
  });
});

describe('تأكيد الخروج النهائي من التطبيق', () => {
  beforeEach(() => {
    // محاكاة منصة يمكن الخروج منها برمجياً (Electron)
    (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    // exitApplication ترفع علامة الإغلاق — نُعيدها كي لا تتأثر بقية الاختبارات
    endShutdown();
  });

  it('زر الرجوع في الرئيسية يعرض حوار التأكيد ولا يخرج مباشرة', async () => {
    await bootApp('#/');
    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy());

    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));

    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy());
    expect(closeSpy).not.toHaveBeenCalled();

    // الإلغاء يُبقي التطبيق مفتوحاً
    fireEvent.click(screen.getByText('متابعة الاستخدام'));
    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).toBeNull());
    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
    closeSpy.mockRestore();
  });

  it('تأكيد الخروج يُغلق التطبيق عبر المنصة', async () => {
    await bootApp('#/');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));
    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy());

    fireEvent.click(screen.getByText('إغلاق التطبيق'));
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    closeSpy.mockRestore();
  });

  it('زر الرجوع أثناء حوار الخروج يُغلق الحوار أولاً ولا يخرج', async () => {
    await bootApp('#/');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));
    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy());

    // ضغطة رجوع ثانية: تُغلق الحوار وحده — الخروج ما زال يحتاج تأكيداً صريحاً
    act(() => lastBackListener?.({ canGoBack: false, exitApp: vi.fn() }));
    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).toBeNull());
    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
    closeSpy.mockRestore();
  });
});
