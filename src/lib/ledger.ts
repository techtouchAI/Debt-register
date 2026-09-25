import { db } from './db';
import { roundMoney, toFiniteNumber } from './utils';
import type { CustomerLedger, Invoice, Payment } from '@/types';

/**
 * دفتر ذمم العملاء هو مصدر الحقيقة للأرصدة. لا تعتمد الشاشات على حقول
 * `remaining` القابلة للتحديث في الفواتير، بل على الحركات الموجبة والسالبة.
 */
export type LedgerEntryType = CustomerLedger['type'];

function validReferenceId(referenceId: number | undefined): referenceId is number {
  return typeof referenceId === 'number' && Number.isInteger(referenceId) && referenceId > 0;
}

async function existingReference(type: LedgerEntryType, referenceId: number): Promise<CustomerLedger | undefined> {
  return db.customerLedger.where('[type+referenceId]').equals([type, referenceId]).first();
}

/** إضافة أو مزامنة حركة موثقة بمصدرها. يمنع الفهرس المركب تكرار الحركة. */
export async function upsertLedgerEntry(input: Omit<CustomerLedger, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  if (!validReferenceId(input.referenceId)) throw new Error('مرجع حركة الذمم غير صالح');
  const amount = roundMoney(toFiniteNumber(input.amount, NaN));
  if (!Number.isFinite(amount) || amount === 0) throw new Error('مبلغ حركة الذمم غير صالح');
  const current = await existingReference(input.type, input.referenceId);
  const now = new Date().toISOString();
  const record: CustomerLedger = {
    ...input,
    amount,
    date: new Date(input.date).toISOString(),
    notes: input.notes?.trim() || undefined,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    ...(current?.id ? { id: current.id } : {})
  };
  return (await db.customerLedger.put(record)) as number;
}

export async function removeLedgerEntry(type: LedgerEntryType, referenceId: number | undefined): Promise<void> {
  if (!validReferenceId(referenceId)) return;
  const current = await existingReference(type, referenceId);
  if (current?.id !== undefined) await db.customerLedger.delete(current.id);
}

/** مزامنة فاتورة آجلة فقط؛ البيع النقدي لا يدخل ذمة العميل. */
export async function syncInvoiceLedger(invoice: Invoice): Promise<void> {
  if (invoice.type !== 'credit' || typeof invoice.customerId !== 'number' || !validReferenceId(invoice.id)) {
    await removeLedgerEntry('invoice', invoice.id);
    return;
  }
  await upsertLedgerEntry({
    customerId: invoice.customerId,
    date: invoice.date,
    type: 'invoice',
    amount: Math.max(0, toFiniteNumber(invoice.total)),
    referenceId: invoice.id,
    notes: `فاتورة مبيعات ${invoice.invoiceNumber}`
  });
}

/** مزامنة وصل قبض؛ كل دفعة تخفض ذمة العميل بما فيها الدفعة المقدمة. */
export async function syncPaymentLedger(payment: Payment): Promise<void> {
  if (typeof payment.customerId !== 'number' || !validReferenceId(payment.id)) {
    await removeLedgerEntry('payment', payment.id);
    return;
  }
  await upsertLedgerEntry({
    customerId: payment.customerId,
    date: payment.date,
    type: 'payment',
    amount: -Math.max(0, toFiniteNumber(payment.amount)),
    referenceId: payment.id,
    notes: `تسديد ${payment.receiptNumber}`
  });
}

export async function removePaymentLedger(paymentId: number | undefined): Promise<void> {
  await removeLedgerEntry('payment', paymentId);
}

export async function getCustomerLedger(customerId: number, throughDate?: string): Promise<CustomerLedger[]> {
  if (!Number.isInteger(customerId) || customerId <= 0) return [];
  const entries = await db.customerLedger.where('customerId').equals(customerId).toArray();
  const upper = throughDate ? new Date(throughDate).getTime() : Number.POSITIVE_INFINITY;
  return entries
    .filter((entry) => Number.isFinite(upper) ? new Date(entry.date).getTime() <= upper : true)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.id ?? 0) - (b.id ?? 0));
}

/** الرصيد الموجب = مبلغ مستحق للمكتب، والسالب = رصيد دائن للعميل. */
export async function getLedgerBalance(customerId: number, throughDate?: string): Promise<number> {
  const entries = await getCustomerLedger(customerId, throughDate);
  return roundMoney(entries.reduce((total, entry) => total + toFiniteNumber(entry.amount), 0));
}

/** الرصيد قبل عملية معينة؛ يستثني مصدر العملية نفسه عند التعديل. */
export async function getLedgerBalanceBefore(
  customerId: number,
  date: string,
  exclude?: { type: LedgerEntryType; referenceId?: number }
): Promise<number> {
  const cutoff = new Date(date).getTime();
  if (!Number.isFinite(cutoff)) return 0;
  const entries = await getCustomerLedger(customerId);
  return roundMoney(
    entries
      .filter((entry) => {
        if (exclude && entry.type === exclude.type && entry.referenceId === exclude.referenceId) return false;
        return new Date(entry.date).getTime() < cutoff;
      })
      .reduce((total, entry) => total + toFiniteNumber(entry.amount), 0)
  );
}
