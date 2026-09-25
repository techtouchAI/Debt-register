import type { Table } from 'dexie';
import { db, getMeta, setMeta } from './db';
import { DOCUMENT_PREFIX, LEGACY_DOCUMENT_PREFIX } from './labels';
import { SEQUENCE_META_PREFIX } from './metaKeys';

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
 *
 * البادئات عربية (ف/ق/ش). الأرقام المحفوظة قبل هذا الإصدار ببادئة إنجليزية
 * (INV/REC/PUR) تُحسب ضمن التسلسل نفسه، فيكمل الترقيم من حيث توقف ولا يتكرر
 * رقم في الشهر نفسه ولو اختلفت البادئة.
 *
 * علامات high-water محفوظة بمفاتيح `seq:<البادئة>` في جدول meta، وهي جزء من
 * النسخة الاحتياطية (انظر `backup.ts`) حتى لا يُعاد استخدام رقم محذوف بعد
 * الاستعادة على جهاز جديد.
 */
type SequenceTable = Table<Record<string, unknown>, number>;

async function highestInTable(table: SequenceTable, index: string, prefix: string): Promise<number> {
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
  return maxInTable;
}

async function highWater(prefix: string): Promise<number> {
  try {
    const stored = await getMeta<number>(`${SEQUENCE_META_PREFIX}${prefix}`);
    return Number.isFinite(stored as number) ? (stored as number) : 0;
  } catch {
    /* جدول meta غير متاح بعد الترقية — نعتمد على الجدول فقط */
    return 0;
  }
}

/** أعلى رقم مستخدم عبر كل البادئات المكافئة (الحالية + القديمة). */
async function highestUsed(table: SequenceTable, index: string, prefixes: readonly string[]): Promise<number> {
  const values = await Promise.all(
    prefixes.flatMap((prefix) => [highestInTable(table, index, prefix), highWater(prefix)])
  );
  return Math.max(0, ...values) + 1;
}

async function allocate(
  table: SequenceTable,
  index: string,
  prefix: string,
  legacyPrefix: string,
  pad: number
): Promise<string> {
  let candidateValue = await highestUsed(table, index, [prefix, legacyPrefix]);
  const build = (value: number) => `${prefix}${String(value).padStart(pad, '0')}`;
  let candidate = build(candidateValue);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const taken = await table.where(index).equals(candidate).count();
    if (taken === 0) break;
    candidateValue += 1;
    candidate = build(candidateValue);
  }

  try {
    await setMeta(`${SEQUENCE_META_PREFIX}${prefix}`, candidateValue);
  } catch (error) {
    console.warn('تعذّر حفظ علامة التسلسل:', error);
  }

  return candidate;
}

const yearMonth = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;

/** رقم فاتورة بصيغة ف-YYYYMM-0001 حسب تاريخ الفاتورة. */
export function nextInvoiceNumber(date: Date = new Date()): Promise<string> {
  const stamp = yearMonth(date);
  return allocate(
    db.invoices as unknown as SequenceTable,
    'invoiceNumber',
    `${DOCUMENT_PREFIX.invoice}-${stamp}-`,
    `${LEGACY_DOCUMENT_PREFIX.invoice}-${stamp}-`,
    4
  );
}

/** رقم وصل قبض بصيغة ق-YYYY-00001 حسب تاريخ التسديد. */
export function nextReceiptNumber(date: Date = new Date()): Promise<string> {
  const stamp = String(date.getFullYear());
  return allocate(
    db.payments as unknown as SequenceTable,
    'receiptNumber',
    `${DOCUMENT_PREFIX.receipt}-${stamp}-`,
    `${LEGACY_DOCUMENT_PREFIX.receipt}-${stamp}-`,
    5
  );
}
