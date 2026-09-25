import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { db } from '@/lib/db';
import { saveInvoice } from '@/lib/invoices';
import { endShutdown } from '@/lib/lifecycle';
import { setNativeBackSubscriber, type NativeBackEvent } from '@/lib/nativeBridge';
import { isBackShortcut, MOUSE_BACK_BUTTON } from '@/lib/desktopBack';
import { parentPath } from '@/lib/navigation';
import { formatCurrency } from '@/lib/utils';
import { seedOfficeProfile } from './helpers';

/**
 * سلسلة الرجوع في كل الصفحات + الكتابة في حقول الأرقام داخل الصفحات الفعلية.
 *
 * القاعدة المختبرة: كل ضغطة رجوع (زر أندرويد، زر الفأرة، Alt+←، أزرار
 * "رجوع" داخل الصفحات) = الصفحة السابقة بالضبط، والسلسلة تنتهي بالرئيسية
 * حيث يظهر حوار تأكيد الخروج — لا مدخلات مكررة ولا عودة لنماذج مُغلقة.
 */

let backListener: ((event: NativeBackEvent) => void) | null = null;

beforeEach(() => {
  cleanup();
  backListener = null;
  window.location.hash = '#/';
  setNativeBackSubscriber((listener) => {
    backListener = listener;
    return { remove: () => undefined };
  });
  (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };
});

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
  endShutdown();
});

async function bootApp(hash = '#/') {
  await seedOfficeProfile();
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('جاري تحميل بيانات المكتب…')).toBeNull(), { timeout: 5000 });
  await waitFor(() => expect(backListener).not.toBeNull(), { timeout: 5000 });
}

const pressBack = () => act(() => backListener?.({ canGoBack: true, exitApp: vi.fn() }));

async function expectHash(hash: string) {
  await waitFor(() => expect(window.location.hash).toBe(hash), { timeout: 3000 });
  // الرابط يتغيّر قبل أن يرسم React الصفحة الجديدة؛ ننتظر اكتمال الرسم كما
  // يحدث فعلياً قبل أن يتمكّن المستخدم من الضغط مرة أخرى.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function expectExitPrompt() {
  await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy(), { timeout: 3000 });
}

/**
 * تنقّل داخل التطبيق كما يفعل النقر على رابط: مدخل جديد في السجل بحالة React
 * Router (`idx` = الفهرس التالي) ثم إشعار الموجّه. تعديل `location.hash`
 * مباشرة لا يصلح هنا لأنه يُنشئ مدخلاً بلا حالة لا يحدث أبداً داخل التطبيق.
 */
async function goTo(hash: string) {
  act(() => {
    const idx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
    window.history.pushState({ usr: null, key: `t${idx}${Math.random().toString(36).slice(2, 6)}`, idx }, '', hash);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  });
  await expectHash(hash);
}

async function seedInvoice() {
  const now = new Date().toISOString();
  const materialId = (await db.materials.add({
    name: 'سماد يوريا',
    quantity: 10,
    salePrice: 1000,
    minQuantity: 1,
    unit: 'كيس',
    category: 'أسمدة',
    createdAt: now,
    updatedAt: now
  })) as number;
  const result = await saveInvoice({
    type: 'cash',
    customerName: 'زبون عابر',
    dateISO: now,
    discount: 0,
    paidAmount: 0,
    notes: '',
    items: [{ materialId, materialName: 'سماد يوريا', quantity: 1, unitPrice: 1000 }]
  });
  if (!result.ok) throw new Error(result.error);
  return { materialId, invoiceId: result.invoiceId };
}

describe('أدوات التنقّل', () => {
  it('الصفحة الأم في الهرم تتقدّم نحو الرئيسية', () => {
    expect(parentPath('/invoices/5/edit')).toBe('/invoices/5');
    expect(parentPath('/invoices/5')).toBe('/invoices');
    expect(parentPath('/invoices')).toBe('/');
    expect(parentPath('/')).toBe('/');
  });

  it('اختصارات الرجوع في سطح المكتب', () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(isBackShortcut(key({ key: 'ArrowLeft', altKey: true }), false)).toBe(true);
    expect(isBackShortcut(key({ key: 'ArrowLeft' }), false)).toBe(false);
    expect(isBackShortcut(key({ key: 'ArrowLeft', altKey: true, shiftKey: true }), false)).toBe(false);
    expect(isBackShortcut(key({ key: '[', metaKey: true }), true)).toBe(true);
    expect(isBackShortcut(key({ key: 'ArrowLeft', altKey: true }), true)).toBe(false);
  });
});

describe('سلسلة الرجوع حتى الرئيسية ثم تأكيد الخروج', () => {
  it('كل صفحة رئيسية: رجوع واحد ⇒ الرئيسية ⇒ حوار الخروج', async () => {
    await bootApp('#/');
    for (const page of ['#/materials', '#/customers', '#/invoices', '#/payments', '#/reports', '#/backup', '#/settings', '#/developer', '#/notifications']) {
      await goTo(page);
      pressBack();
      await expectHash('#/');
    }
    pressBack();
    await expectExitPrompt();
  });

  it('سلسلة عميقة: الرئيسية ← الفواتير ← الفاتورة ← التعديل، ثم رجوع خطوة خطوة', async () => {
    const { invoiceId } = await seedInvoice();
    await bootApp('#/');
    await goTo('#/invoices');
    await goTo(`#/invoices/${invoiceId}`);
    await goTo(`#/invoices/${invoiceId}/edit`);

    pressBack();
    await expectHash(`#/invoices/${invoiceId}`);
    pressBack();
    await expectHash('#/invoices');
    pressBack();
    await expectHash('#/');
    pressBack();
    await expectExitPrompt();
  });

  it('فتح مباشر على صفحة داخلية (بلا سجل): الرجوع يصعد في الهرم حتى الرئيسية', async () => {
    const { invoiceId } = await seedInvoice();
    await bootApp(`#/invoices/${invoiceId}`);
    await waitFor(() => screen.getByLabelText('رجوع للفواتير'), { timeout: 5000 });

    pressBack();
    await expectHash('#/invoices');
    pressBack();
    await expectHash('#/');
    pressBack();
    await expectExitPrompt();
  });

  it('زر "رجوع" داخل الصفحة يرجع فعلاً ولا يُنشئ سجلاً دائرياً', async () => {
    const { invoiceId } = await seedInvoice();
    await bootApp('#/');
    await goTo('#/invoices');
    await goTo(`#/invoices/${invoiceId}`);
    fireEvent.click(await screen.findByLabelText('رجوع للفواتير', undefined, { timeout: 5000 }));
    await expectHash('#/invoices');

    // الخلل القديم: زر النظام كان يعيد المستخدم إلى الفاتورة التي غادرها
    pressBack();
    await expectHash('#/');
    pressBack();
    await expectExitPrompt();
  });

  it('كشف حساب الزبون: زر الرجوع يعود للعملاء ثم الرئيسية', async () => {
    const now = new Date().toISOString();
    const customerId = await db.customers.add({ fullName: 'أبو علي', phone: '', address: '', createdAt: now, updatedAt: now } as never);
    await bootApp('#/');
    await goTo('#/customers');
    await goTo(`#/customers/${customerId}`);
    fireEvent.click(await screen.findByLabelText('رجوع للعملاء', undefined, { timeout: 5000 }));
    await expectHash('#/customers');
    pressBack();
    await expectHash('#/');
  });

  it('إلغاء نموذج التسديد السريع ثم الرجوع لا يعيد فتح النموذج', async () => {
    await bootApp('#/');
    await goTo('#/customers');
    await goTo('#/payments/new');
    await screen.findByText('إلغاء', undefined, { timeout: 5000 });

    fireEvent.click(screen.getByText('إلغاء'));
    await expectHash('#/payments');
    await waitFor(() => expect(screen.queryByText('إلغاء')).toBeNull());

    pressBack();
    await expectHash('#/customers');
    expect(screen.queryByText('إلغاء')).toBeNull();
    pressBack();
    await expectHash('#/');
  });

  it('إلغاء نموذج إضافة المادة السريع ثم الرجوع لا يعيد فتح النموذج', async () => {
    await bootApp('#/');
    await goTo('#/materials?action=new');
    await screen.findByText('إلغاء', undefined, { timeout: 5000 });

    fireEvent.click(screen.getByText('إلغاء'));
    await expectHash('#/materials');
    pressBack();
    await expectHash('#/');
    expect(screen.queryByText('إلغاء')).toBeNull();
  });
});

describe('زر الفأرة الخلفي و Alt+← (سطح المكتب)', () => {
  it('يرجع صفحة واحدة ثم يعرض حوار الخروج في الرئيسية', async () => {
    await bootApp('#/');
    await goTo('#/customers');

    fireEvent.mouseDown(window, { button: MOUSE_BACK_BUTTON });
    const mouseUp = new MouseEvent('mouseup', { button: MOUSE_BACK_BUTTON, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(mouseUp);
    });
    // سلوك المتصفح الافتراضي أُلغي — القرار لنا وحدنا (لا رجوع مزدوج)
    expect(mouseUp.defaultPrevented).toBe(true);
    await expectHash('#/');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
    });
    await expectExitPrompt();
  });
});

describe('الكتابة في حقول الفاتورة', () => {
  it('مسح الكمية لا يحذف السطر، وتجاوز المخزون يظهر كتنبيه بدل رفض الكتابة', async () => {
    await seedInvoice();
    await bootApp('#/invoices/new');
    const search = await screen.findByPlaceholderText(/ابحث باسم المادة/, undefined, { timeout: 5000 });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'يوريا' } });
    fireEvent.click(await screen.findByText('سماد يوريا'));

    const quantity = (await screen.findByLabelText('كمية سماد يوريا')) as HTMLInputElement;
    expect(quantity.value).toBe('1');

    // مسح الحقل للكتابة من جديد: السطر يبقى (كان يُحذف فوراً)
    fireEvent.change(quantity, { target: { value: '' } });
    expect(screen.getByLabelText('كمية سماد يوريا')).toBe(quantity);
    expect(quantity.value).toBe('');
    expect(screen.getByText('أدخل كمية أكبر من صفر')).toBeTruthy();

    // أكبر من المتوفر: يُكتب كما هو ويظهر التنبيه (كان يُرفض ويرجع الرقم القديم)
    fireEvent.change(quantity, { target: { value: '١٥' } });
    expect(quantity.value).toBe('15');
    // المخزون 10 استُهلك منها 1 في الفاتورة المزروعة ⇒ المتوفر 9
    expect(screen.getByText('يتجاوز المتوفر (9)')).toBeTruthy();

    fireEvent.change(quantity, { target: { value: '3' } });
    expect(quantity.value).toBe('3');
    expect(screen.queryByRole('alert')).toBeNull();

    // السعر: تحديد الكل والكتابة فوقه
    const price = screen.getByLabelText('سعر سماد يوريا') as HTMLInputElement;
    price.focus();
    price.setSelectionRange(0, price.value.length);
    fireEvent.change(price, { target: { value: '1250' } });
    expect(price.value).toBe('1250');
    expect(screen.getAllByText(formatCurrency(3750)).length).toBeGreaterThan(0);
  });
});
