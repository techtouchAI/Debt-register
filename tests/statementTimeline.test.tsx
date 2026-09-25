import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import App from '@/App';
import { db } from '@/lib/db';
import { saveInvoice } from '@/lib/invoices';
import { getCustomerBalance } from '@/lib/debts';
import { seedOfficeProfile } from './helpers';

/**
 * السجل الزمني في كشف حساب الزبون — الخلل المُبلَّغ عنه:
 * كانت بطاقات الفواتير تخرج عن حدود البطاقة وتنضغط على شاشات الهاتف.
 *
 * الحارس هنا بنيوي: بطاقة السجل تحمل `min-w-0` (تسمح بالانكماش داخل
 * العمود)، ورأسها يلتف (`flex-wrap`)، والملاحظات الطويلة تُكسر داخل حدودها
 * ولا تمدّ الصفحة أفقياً. وتُتحقّق أيضاً سلامة المحتوى: الرصيد السابق
 * المحمول يظهر على الفاتورة في السجل.
 */

/** أسوأ حالة للنص: ملاحظة طويلة جداً بلا أي مسافة (لا يوجد موضع كسر طبيعي) */
const LONG_NOTE = 'ملاحظةبلااااااااااااااااافواصل'.repeat(8);

async function seedStatement() {
  await seedOfficeProfile('مكتب الاختبار الزراعي');
  const first = new Date('2026-05-03T09:00:00Z').toISOString();
  const second = new Date('2026-05-04T09:00:00Z').toISOString();
  const customerId = (await db.customers.add({
    fullName: 'زبون اختبار طويل الاسم قليلاً',
    phone: '07801234567',
    address: 'الأنبار - الكرمة',
    createdAt: first,
    updatedAt: first
  })) as number;
  const materialId = (await db.materials.add({
    name: 'سماد يوريا',
    quantity: 100,
    salePrice: 1000,
    minQuantity: 1,
    unit: 'كيس',
    createdAt: first,
    updatedAt: first
  })) as number;

  const firstInvoice = await saveInvoice({
    type: 'credit',
    customerId,
    customerName: 'زبون اختبار طويل الاسم قليلاً',
    dateISO: first,
    discount: 0,
    paidAmount: 0,
    items: [{ materialId, materialName: 'سماد يوريا', quantity: 2, unitPrice: 1000 }]
  });
  if (!firstInvoice.ok) throw new Error(firstInvoice.error);

  const secondInvoice = await saveInvoice({
    type: 'credit',
    customerId,
    customerName: 'زبون اختبار طويل الاسم قليلاً',
    dateISO: second,
    discount: 0,
    paidAmount: 300,
    notes: LONG_NOTE,
    items: [{ materialId, materialName: 'سماد يوريا', quantity: 1, unitPrice: 1000 }]
  });
  if (!secondInvoice.ok) throw new Error(secondInvoice.error);

  return { customerId, carriedInvoiceId: secondInvoice.invoiceId };
}

beforeEach(() => {
  cleanup();
  window.location.hash = '#/';
});

describe('السجل الزمني في كشف حساب الزبون', () => {
  it('يعرض الفاتورة والتسديد في بطاقات ملتفة لا تخرج عن الحدود', async () => {
    const { customerId, carriedInvoiceId } = await seedStatement();
    // دين الزبون = 2000 + 1000 − 300
    expect((await getCustomerBalance(customerId)).debt).toBe(2700);

    window.location.hash = `#/customers/${customerId}`;
    render(<App />);

    await waitFor(() => expect(screen.getByText('السجل الزمني التفصيلي')).toBeTruthy(), { timeout: 5000 });
    const entries = await screen.findAllByTestId('statement-timeline-item', undefined, { timeout: 5000 });
    // فاتورتان + وصل القبض الناتج عن دفعة المقدمة
    expect(entries).toHaveLength(3);

    // الفاتورة الأحدث (صاحبة الملاحظة الطويلة) هي أول بطاقة في السجل
    const note = within(entries[0]).getByText(LONG_NOTE);
    const card = note.closest('[data-testid="statement-timeline-item"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('data-testid')).toBe('statement-timeline-item');

    // أعمدة قابلة للانضغاط + رأس يلتف + نص يُكسر داخل الحدود
    expect(card.querySelector('.min-w-0')).toBeTruthy();
    expect(card.querySelector('.flex-wrap')).toBeTruthy();
    expect(note.className).toContain('break-words');
    expect(note.className).toContain('[overflow-wrap:anywhere]');

    // اللقطة المثبتة على الفاتورة الثانية (الدين القديم) ظاهرة في السجل
    expect(within(card).getByText(/منها رصيد سابق/)).toBeTruthy();
    expect(within(card).getByText(/فاتورة آجل/)).toBeTruthy();

    // رابط تفاصيل الفاتورة ما زال يقود للفاتورة الصحيحة
    const detailsLink = within(card).getByRole('link', { name: 'عرض تفاصيل الفاتورة ←' });
    expect(detailsLink.getAttribute('href')).toBe(`#/invoices/${carriedInvoiceId}`);

    // دفعة المقدمة تظهر كتسديد مستقل مع الرصيد بعدها
    const paymentEntry = entries.find((entry) => within(entry).queryByText('تسديد') !== null) as HTMLElement;
    expect(paymentEntry).toBeTruthy();
    // دفعة المقدمة كُتبت كوصل قبض حقيقي يظهر في السجل بمبلغه وطريقته
    expect(within(paymentEntry).getByText(/تسديد دين/)).toBeTruthy();
    expect(within(paymentEntry).getByText(new RegExp((300).toLocaleString('ar-IQ')))).toBeTruthy();
  });
});
