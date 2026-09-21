import { db, logActivity, createNotification, getSettingsOrDefault } from './db';
import { nextReceiptNumber } from './sequence';
import { reallocateCustomerInvoices } from './invoices';
import { getCustomerBalance } from './debts';
import { formatCurrency, roundMoney, toFiniteNumber, toISOStringOrNull } from './utils';
import type { Payment } from '@/types';

export interface PaymentDraft {
  customerId: number;
  amount: number;
  /** تاريخ بصيغة ISO */
  dateISO: string;
  method: Payment['method'];
  notes?: string;
}

export type PaymentSaveResult =
  | { ok: true; payment: Payment; debtBefore: number; debtAfter: number; receiptNumber: string }
  | { ok: false; error: string };

export async function savePayment(draft: PaymentDraft): Promise<PaymentSaveResult> {
  if (!Number.isInteger(draft.customerId) || draft.customerId <= 0) return { ok: false, error: 'يرجى اختيار زبون' };
  if (draft.method !== 'cash' && draft.method !== 'transfer' && draft.method !== 'other') {
    return { ok: false, error: 'طريقة الدفع غير صالحة' };
  }

  const amount = roundMoney(toFiniteNumber(draft.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'يرجى إدخال مبلغ صحيح' };
  const dateISO = toISOStringOrNull(draft.dateISO);
  if (!dateISO) return { ok: false, error: 'تاريخ التسديد غير صالح' };

  const saved = await db.transaction('rw', [db.payments, db.invoices, db.customers, db.meta], async () => {
    const customer = await db.customers.get(draft.customerId);
    if (!customer) return { ok: false as const, error: 'الزبون غير موجود' };

    // الرصيد يُقرأ داخل المعاملة حتى لا يُحسب من بيانات قديمة
    const before = await getCustomerBalance(draft.customerId);
    const receiptNumber = await nextReceiptNumber(new Date(dateISO));
    const debtAfter = roundMoney(before.debt - amount);

    const paymentId = (await db.payments.add({
      customerId: draft.customerId,
      customerName: customer.fullName,
      amount,
      date: dateISO,
      method: draft.method,
      receiptNumber,
      remainingAfter: Math.max(0, debtAfter),
      notes: draft.notes?.trim() ? draft.notes.trim() : undefined,
      createdAt: new Date().toISOString(),
      source: 'manual'
    })) as number;

    // تحديث حالة فواتير الزبون (أقدم فاتورة أولاً)
    await reallocateCustomerInvoices(draft.customerId);

    const payment = (await db.payments.get(paymentId)) as Payment;
    return { ok: true as const, payment, debtBefore: before.debt, debtAfter, receiptNumber };
  });

  if (!saved.ok) return saved;

  const settings = await getSettingsOrDefault();
  await logActivity(
    'تسديد دين',
    `تم تسديد ${formatCurrency(amount, settings.currency)} من الزبون ${saved.payment.customerName} - وصل ${saved.receiptNumber}`,
    'payment',
    saved.payment.id
  ).catch((error) => console.warn('تعذّر تسجيل النشاط:', error));

  if (saved.debtBefore > 0 && saved.debtAfter <= 0) {
    await createNotification(
      'تم تسديد الدين بالكامل',
      `الزبون ${saved.payment.customerName} سدد جميع ديونه. المبلغ: ${formatCurrency(amount, settings.currency)}`,
      { type: 'success', relatedId: draft.customerId, relatedType: 'customer', code: 'debt-cleared' }
    ).catch((error) => console.warn('تعذّر إنشاء الإشعار:', error));
  }

  return saved;
}

export type PaymentDeleteResult = { ok: true } | { ok: false; error: string };

export async function deletePayment(paymentId: number): Promise<PaymentDeleteResult> {
  const deleted = await db.transaction('rw', [db.payments, db.invoices], async () => {
    const payment = await db.payments.get(paymentId);
    if (!payment) return { ok: false as const, error: 'وصل القبض غير موجود' };
    if (payment.source === 'downpayment') {
      return {
        ok: false as const,
        error: 'لا يمكن حذف دفعة مقدمة مرتبطة بفاتورة. احذف أو عدّل الفاتورة نفسها.'
      };
    }

    await db.payments.delete(paymentId);
    await reallocateCustomerInvoices(payment.customerId);
    return { ok: true as const, payment };
  });

  if (!deleted.ok) return { ok: false, error: deleted.error };

  const settings = await getSettingsOrDefault();
  await logActivity(
    'حذف تسديد',
    `تم حذف تسديد ${formatCurrency(deleted.payment.amount, settings.currency)} للزبون ${deleted.payment.customerName}`,
    'payment',
    paymentId
  ).catch((error) => console.warn('تعذّر تسجيل النشاط:', error));

  return { ok: true };
}
