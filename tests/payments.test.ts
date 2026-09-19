import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import { saveInvoice, deleteInvoice } from '@/lib/invoices';
import { savePayment, deletePayment } from '@/lib/payments';
import { getCustomerBalance, getCustomerBalances, computeBalance } from '@/lib/debts';
import type { Material } from '@/types';

async function addMaterial(partial: Partial<Material> & { name: string }): Promise<number> {
  const now = new Date().toISOString();
  return (await db.materials.add({
    quantity: 0,
    salePrice: 1000,
    minQuantity: 5,
    unit: 'قطعة',
    category: 'عام',
    createdAt: now,
    updatedAt: now,
    ...partial
  })) as number;
}

async function addCustomer(fullName: string): Promise<number> {
  const now = new Date().toISOString();
  return (await db.customers.add({ fullName, createdAt: now, updatedAt: now })) as number;
}

async function creditInvoice(customerId: number, customerName: string, total: number, dateISO: string, materialId: number) {
  const quantity = total / 1000;
  return saveInvoice({
    type: 'credit',
    customerId,
    customerName,
    dateISO,
    discount: 0,
    paidAmount: 0,
    items: [{ materialId, materialName: 'سماد', quantity, unitPrice: 1000 }]
  });
}

describe('التسديدات', () => {
  it('يخفض الدين ويوزّع المبلغ على أقدم الفواتير', async () => {
    const customerId = await addCustomer('زبون');
    const materialId = await addMaterial({ name: 'سماد', quantity: 1000 });

    await creditInvoice(customerId, 'زبون', 10000, '2026-01-05T09:00:00.000Z', materialId);
    await creditInvoice(customerId, 'زبون', 20000, '2026-02-05T09:00:00.000Z', materialId);

    const result = await savePayment({
      customerId,
      amount: 12000,
      dateISO: '2026-02-10T09:00:00.000Z',
      method: 'cash'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtBefore).toBe(30000);
    expect(result.debtAfter).toBe(18000);
    expect(result.payment.remainingAfter).toBe(18000);

    const invoices = await db.invoices.orderBy('date').toArray();
    expect(invoices[0].paidAmount).toBe(10000);
    expect(invoices[0].status).toBe('paid');
    expect(invoices[0].remaining).toBe(0);
    expect(invoices[1].paidAmount).toBe(2000);
    expect(invoices[1].status).toBe('partial');
    expect(invoices[1].remaining).toBe(18000);
  });

  it('يرفض المبلغ غير الصالح والزبون غير الموجود', async () => {
    const customerId = await addCustomer('زبون');
    expect((await savePayment({ customerId, amount: 0, dateISO: new Date().toISOString(), method: 'cash' })).ok).toBe(false);
    expect((await savePayment({ customerId, amount: -5, dateISO: new Date().toISOString(), method: 'cash' })).ok).toBe(false);
    expect(
      (await savePayment({ customerId: 4242, amount: 100, dateISO: new Date().toISOString(), method: 'cash' })).ok
    ).toBe(false);
    expect(await db.payments.count()).toBe(0);
  });

  it('حذف التسديد يعيد الدين ويحدّث حالة الفواتير', async () => {
    const customerId = await addCustomer('زبون');
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });
    const invoice = await creditInvoice(customerId, 'زبون', 10000, '2026-01-05T09:00:00.000Z', materialId);
    if (!invoice.ok) throw new Error('invoice failed');

    const payment = await savePayment({ customerId, amount: 10000, dateISO: '2026-01-06T09:00:00.000Z', method: 'cash' });
    if (!payment.ok) throw new Error('payment failed');
    expect((await getCustomerBalance(customerId)).debt).toBe(0);

    const deleted = await deletePayment(payment.payment.id as number);
    expect(deleted.ok).toBe(true);
    expect((await getCustomerBalance(customerId)).debt).toBe(10000);

    const refreshed = await db.invoices.get(invoice.invoiceId);
    expect(refreshed?.status).toBe('unpaid');
    expect(refreshed?.remaining).toBe(10000);
  });

  it('لا يسمح بحذف دفعة مقدمة مرتبطة بفاتورة', async () => {
    const customerId = await addCustomer('زبون');
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });

    await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'زبون',
      dateISO: '2026-01-05T09:00:00.000Z',
      discount: 0,
      paidAmount: 3000,
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });

    const downPayment = await db.payments.toCollection().first();
    expect(downPayment?.source).toBe('downpayment');

    const result = await deletePayment(downPayment!.id as number);
    expect(result.ok).toBe(false);
    expect(await db.payments.count()).toBe(1);
  });

  it('حذف فاتورة آجلة بعد التسديد يعيد توزيع المبلغ المتبقي', async () => {
    const customerId = await addCustomer('زبون');
    const materialId = await addMaterial({ name: 'سماد', quantity: 1000 });

    const first = await creditInvoice(customerId, 'زبون', 10000, '2026-01-05T09:00:00.000Z', materialId);
    await creditInvoice(customerId, 'زبون', 20000, '2026-02-05T09:00:00.000Z', materialId);
    await savePayment({ customerId, amount: 10000, dateISO: '2026-03-01T09:00:00.000Z', method: 'cash' });
    if (!first.ok) throw new Error('invoice failed');

    await deleteInvoice(first.invoiceId);

    const balance = await getCustomerBalance(customerId);
    expect(balance.credit).toBe(20000);
    expect(balance.paid).toBe(10000);
    expect(balance.debt).toBe(10000);

    const remainingInvoice = await db.invoices.toCollection().first();
    expect(remainingInvoice?.paidAmount).toBe(10000);
    expect(remainingInvoice?.status).toBe('partial');
  });
});

describe('حساب الأرصدة', () => {
  it('يحسب أرصدة كل الزبائن بمرور واحد', async () => {
    const first = await addCustomer('أ');
    const second = await addCustomer('ب');
    const materialId = await addMaterial({ name: 'سماد', quantity: 1000 });

    await creditInvoice(first, 'أ', 5000, '2026-01-05T09:00:00.000Z', materialId);
    await creditInvoice(second, 'ب', 7000, '2026-01-06T09:00:00.000Z', materialId);
    await savePayment({ customerId: first, amount: 2000, dateISO: '2026-01-07T09:00:00.000Z', method: 'cash' });

    const balances = await getCustomerBalances();
    expect(balances.get(first)?.debt).toBe(3000);
    expect(balances.get(second)?.debt).toBe(7000);
    expect(balances.get(first)?.paid).toBe(2000);
  });

  it('لا يحتسب الفواتير النقدية ضمن الدين', () => {
    const balance = computeBalance(
      [
        { id: 1, invoiceNumber: 'a', type: 'cash', customerName: 'x', itemsCount: 1, subtotal: 100, discount: 0, total: 100, paidAmount: 100, remaining: 0, date: '', createdAt: '', status: 'paid' },
        { id: 2, invoiceNumber: 'b', type: 'credit', customerName: 'x', itemsCount: 1, subtotal: 50, discount: 0, total: 50, paidAmount: 0, remaining: 50, date: '', createdAt: '', status: 'unpaid' }
      ],
      []
    );
    expect(balance.credit).toBe(50);
    expect(balance.debt).toBe(50);
  });

  it('يتجاهل القيم غير الرقمية في السجلات القديمة', () => {
    const balance = computeBalance(
      [
        { id: 1, invoiceNumber: 'a', type: 'credit', customerName: 'x', itemsCount: 1, subtotal: 100, discount: 0, total: 'abc' as unknown as number, paidAmount: 0, remaining: 0, date: '', createdAt: '', status: 'unpaid' }
      ],
      [{ id: 1, customerId: 1, customerName: 'x', amount: null as unknown as number, date: '', method: 'cash', receiptNumber: 'r', createdAt: '' }]
    );
    expect(balance.credit).toBe(0);
    expect(balance.paid).toBe(0);
    expect(balance.debt).toBe(0);
  });
});
