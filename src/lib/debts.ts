import { db } from './db';
import type { Invoice, Payment } from '@/types';
import { roundMoney, toFiniteNumber } from './utils';

/**
 * رصيد الزبون:
 *   دين = مجموع الفواتير الآجلة − مجموع التسديدات
 * يُحسب دائماً من السجلات الأصلية (لا قيم مخزنة قابلة للتلف).
 */
export interface CustomerBalance {
  /** مجموع الفواتير الآجلة */
  credit: number;
  /** مجموع المسدد */
  paid: number;
  /** المتبقي (قد يكون سالباً عند الدفع الزائد) */
  debt: number;
}

export function emptyBalance(): CustomerBalance {
  return { credit: 0, paid: 0, debt: 0 };
}

export function computeBalance(invoices: Invoice[], payments: Payment[]): CustomerBalance {
  const credit = roundMoney(
    invoices
      .filter((invoice) => invoice.type === 'credit')
      .reduce((sum, invoice) => sum + toFiniteNumber(invoice.total), 0)
  );
  const paid = roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));
  return { credit, paid, debt: roundMoney(credit - paid) };
}

/**
 * أرصدة كل الزبائن بمرور واحد على الجدولين.
 * بديل عن حلقة تستعلم مرتين لكل زبون (كانت تُبطئ لوحة التحكم والتقارير
 * بشكل ملحوظ مع تراكم فواتير سنة كاملة).
 */
export async function getCustomerBalances(): Promise<Map<number, CustomerBalance>> {
  const balances = new Map<number, CustomerBalance>();

  const ensure = (customerId: number): CustomerBalance => {
    let balance = balances.get(customerId);
    if (!balance) {
      balance = emptyBalance();
      balances.set(customerId, balance);
    }
    return balance;
  };

  await db.invoices
    .where('type')
    .equals('credit')
    .each((invoice) => {
      if (typeof invoice.customerId !== 'number') return;
      const balance = ensure(invoice.customerId);
      balance.credit = roundMoney(balance.credit + toFiniteNumber(invoice.total));
    });

  await db.payments.each((payment) => {
    if (typeof payment.customerId !== 'number') return;
    const balance = ensure(payment.customerId);
    balance.paid = roundMoney(balance.paid + toFiniteNumber(payment.amount));
  });

  for (const balance of balances.values()) {
    balance.debt = roundMoney(balance.credit - balance.paid);
  }

  return balances;
}

/** رصيد زبون واحد. */
export async function getCustomerBalance(customerId: number): Promise<CustomerBalance> {
  const [invoices, payments] = await Promise.all([
    db.invoices.where('customerId').equals(customerId).toArray(),
    db.payments.where('customerId').equals(customerId).toArray()
  ]);
  return computeBalance(invoices, payments);
}

export async function getCustomerDebt(customerId: number): Promise<number> {
  const balance = await getCustomerBalance(customerId);
  return balance.debt;
}

export async function getAllCustomersDebt(): Promise<{ customerId: number; debt: number }[]> {
  const balances = await getCustomerBalances();
  return Array.from(balances.entries()).map(([customerId, balance]) => ({ customerId, debt: balance.debt }));
}
