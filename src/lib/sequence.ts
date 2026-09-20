import type { Table } from 'dexie';
import { db, getMeta, setMeta } from './db';

/**
 * مولّد أرقام تسلسلية فريدة وغير قابلة لإعادة الاستخدام.
 *
 * لماذا لا نستخدم `count() + 1`:
 *  - بعد حذف أي فاتورة يتكرر رقم موجود أو يُعاد استخدام رقم فاتورة محذوفة
 *    ما زالت نسختها الورقية عند الزبون، وهو خلل محاسبي في سجل رسمي.
 *
 * الآلية: أعلى رقم مستخدم في الجدول ∪ أعلى رقم محفوظ في جدول meta (علامة
 * high-water) ثم التحقق من عدم استخدام الرقم. إذا تراجعت المعاملة لاحقاً
 * يُفقد الرقم فقط ولا يُعاد استخدامه.
 */
async function highestUsed(
  table: Table<Record<string, unknown>, number>,
  index: string,
  prefix: string
): Promise<number> {
  let maxInTable = 0;
  try {
    const keys = (await table.where(index).between(prefix, `${prefix}\uffff`, true, false).keys()) as unknown[];
    for (const key of keys) {
      const suffix = Number(String(key).slice(prefix.length));
      if (Number.isFinite(suffix) && suffix > maxInTable) maxInTable = suffix;
    }
  } catch (error) {
    console.warn('تعذّر قراءة الأرقام السابقة:', error);
  }

  const metaKey = `seq:${prefix}`;
  let highWater = 0;
  try {
    const stored = await getMeta<number>(metaKey);
    if (Number.isFinite(stored as number)) highWater = stored as number;
  } catch {
    /* جدول meta غير متاح بعد الترقية — نعتمد على الجدول فقط */
  }

  return Math.max(maxInTable, highWater) + 1;
}

async function allocate(
  table: Table<Record<string, unknown>, number>,
  index: string,
  prefix: string,
  pad: number
): Promise<string> {
  const metaKey = `seq:${prefix}`;
  let candidateValue = await highestUsed(table, index, prefix);
  const build = (value: number) => `${prefix}${String(value).padStart(pad, '0')}`;
  let candidate = build(candidateValue);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const taken = await table.where(index).equals(candidate).count();
    if (taken === 0) break;
    candidateValue += 1;
    candidate = build(candidateValue);
  }

  try {
    await setMeta(metaKey, candidateValue);
  } catch (error) {
    console.warn('تعذّر حفظ علامة التسلسل:', error);
  }

  return candidate;
}

/** رقم فاتورة بصيغة INV-YYYYMM-0001 حسب تاريخ الفاتورة. */
export function nextInvoiceNumber(date: Date = new Date()): Promise<string> {
  const prefix = `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-`;
  return allocate(db.invoices as unknown as Table<Record<string, unknown>, number>, 'invoiceNumber', prefix, 4);
}

/** رقم وصل قبض بصيغة REC-YYYY-00001 حسب تاريخ التسديد. */
export function nextReceiptNumber(date: Date = new Date()): Promise<string> {
  const prefix = `REC-${date.getFullYear()}-`;
  return allocate(db.payments as unknown as Table<Record<string, unknown>, number>, 'receiptNumber', prefix, 5);
}

/** رقم وصل شراء بصيغة PUR-YYYYMM-0001 حسب تاريخ الشراء. */
export function nextPurchaseNumber(date: Date = new Date()): Promise<string> {
  const prefix = `PUR-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-`;
  return allocate(db.purchases as unknown as Table<Record<string, unknown>, number>, 'purchaseNumber', prefix, 4);
}
