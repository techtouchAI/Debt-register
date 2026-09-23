import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { updateSettings } from '@/lib/db';
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
 *   - عدم خروج التطبيق من الصفحة الرئيسية.
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
  await updateSettings({ officeName });
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
  it('يغلق الطبقة أولاً ثم يرجع ثم يبقى في الرئيسية', () => {
    expect(resolveBackIntent({ hasOpenOverlay: true, pathname: '/customers' })).toEqual({
      action: 'close-overlay'
    });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/customers' })).toEqual({
      action: 'navigate-back'
    });
    expect(resolveBackIntent({ hasOpenOverlay: false, pathname: '/' })).toEqual({ action: 'stay-home' });
    // في الرئيسية مع وجود سجل: نرجع بدل الخروج
    expect(
      resolveBackIntent({ hasOpenOverlay: false, pathname: '/', canGoBackInHistory: true })
    ).toEqual({ action: 'navigate-back' });
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

  it('لا يخرج التطبيق من الصفحة الرئيسية', async () => {
    await bootApp('#/');
    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy());

    const exitApp = vi.fn();
    act(() => lastBackListener?.({ canGoBack: false, exitApp }));

    await waitFor(() => expect(screen.getByText('أنت في الصفحة الرئيسية')).toBeTruthy());
    expect(exitApp).not.toHaveBeenCalled();
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
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
      state: null,
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

describe('Escape والنوافذ المتعددة', () => {
  it('يُغلق الطبقة العليا وحدها ثم التي تحتها', async () => {
    await bootApp('#/customers');
    fireEvent.click(screen.getByText('إضافة زبون جديد'));
    await waitFor(() => expect(screen.getByText('الاسم الكامل *')).toBeTruthy());

    // نافذة ثانية مفتوحة فوق الأولى (معاينة مستند) لاختبار الترتيب LIFO
    const { DocumentPreviewDialog } = await import('@/components/documents/DocumentPreviewDialog');
    const overlay = render(
      <DocumentPreviewDialog
        open
        title="معاينة"
        bodyHtml="<p>مستند</p>"
        fileNameBase="doc"
        onClose={() => {
          overlay.unmount();
        }}
      />
    );
    await waitFor(() => expect(openModalCount()).toBe(2));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(openModalCount()).toBe(1));
    // النافذة الأولى ما زالت مفتوحة: Escape أُغلق الطبقة العليا فقط
    expect(screen.getByText('الاسم الكامل *')).toBeTruthy();
    expect(openModalCount()).toBe(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('الاسم الكامل *')).toBeNull());
    expect(openModalCount()).toBe(0);
  });

  it('الضغط المتكرر على Escape لا يفعل شيئاً بعد إغلاق كل الطبقات', async () => {
    await bootApp('#/customers');
    fireEvent.click(screen.getByText('إضافة زبون جديد'));
    await waitFor(() => expect(screen.getByText('الاسم الكامل *')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(hasOpenModal()).toBe(false));
    expect(window.location.hash).toBe('#/customers');
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
