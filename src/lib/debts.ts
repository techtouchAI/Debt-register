import { db } from './db';
import { roundMoney, toFiniteNumber } from './utils';
import { getLedgerBalance, getCustomerLedger, getLedgerBalanceBefore } from './ledger';
import type { Invoice, Payment } from '@/types';

/** ملخص متوافق مع واجهات العرض القائمة؛ مصدره الآن دفتر الذمم فقط. */
export interface CustomerBalance {
  credit: number;
  paid: number;
  debt: number;
}

export function emptyBalance(): CustomerBalance {
  return { credit: 0, paid: 0, debt: 0 };
}

/**
 * دالة توافق للبيانات المؤقتة والاختبارات فقط. الحسابات التشغيلية لا تستدعيها؛
 * بل تقرأ من customer_ledger حتى لا تتأثر برصيد فاتورة mutable.
 */
export function computeBalance(invoices: Invoice[], payments: Payment[]): CustomerBalance {
  const credit = roundMoney(invoices.filter((invoice) => invoice.type === 'credit').reduce((sum, invoice) => sum + toFiniteNumber(invoice.total), 0));
  const paid = roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));
  return { credit, paid, debt: roundMoney(credit - paid) };
}

function applyEntry(balance: CustomerBalance, entry: { type: string; amount: number }): CustomerBalance {
  const amount = roundMoney(toFiniteNumber(entry.amount));
  if (entry.type === 'invoice') balance.credit = roundMoney(balance.credit + Math.max(0, amount));
  else if (amount < 0) balance.paid = roundMoney(balance.paid + Math.abs(amount));
  else balance.credit = roundMoney(balance.credit + amount);
  balance.debt = roundMoney(balance.debt + amount);
  return balance;
}

/** أرصدة العملاء من دفتر الحركات بمرور واحد. */
export async function getCustomerBalances(): Promise<Map<number, CustomerBalance>> {
  const balances = new Map<number, CustomerBalance>();
  await db.customerLedger.each((entry) => {
    const current = balances.get(entry.customerId) ?? emptyBalance();
    balances.set(entry.customerId, applyEntry(current, entry));
  });
  return balances;
}

/** رصيد العميل الحالي أو حتى تاريخ محدد. */
export async function getCustomerBalance(customerId: number, throughDate?: string): Promise<CustomerBalance> {
  const entries = await getCustomerLedger(customerId, throughDate);
  return entries.reduce((balance, entry) => applyEntry(balance, entry), emptyBalance());
}

export async function getCustomerDebt(customerId: number): Promise<number> {
  return getLedgerBalance(customerId);
}

/**
 * الرصيد المستحق قبل تاريخ العملية. من دون تاريخ يعيد الرصيد الحالي للتوافق
 * مع شاشات الملخص؛ أما مع التاريخ فيستثني كل حركة تقع في لحظة العملية نفسها
 * أو بعدها، وهو ما تحتاجه لقطة الرصيد السابق في الفاتورة المؤرخة.
 */
export async function getCustomerPreviousBalance(customerId: number, beforeDate?: string): Promise<number> {
  if (beforeDate) return Math.max(0, await getLedgerBalanceBefore(customerId, beforeDate));
  const balance = await getCustomerBalance(customerId);
  return Math.max(0, balance.debt);
}

export async function getAllCustomersDebt(): Promise<{ customerId: number; debt: number }[]> {
  const balances = await getCustomerBalances();
  return Array.from(balances.entries()).map(([customerId, balance]) => ({ customerId, debt: balance.debt }));
}
