import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import {
  saveInvoice,
  deleteInvoice,
  getInvoiceWithItems,
  computeInvoiceTotals,
  validateInvoiceDraft,
  reallocateCustomerInvoices
} from '@/lib/invoices';
import { nextInvoiceNumber } from '@/lib/sequence';
import { getCustomerBalance } from '@/lib/debts';
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

async function addCustomer(fullName = 'زبون اختبار'): Promise<number> {
  const now = new Date().toISOString();
  return (await db.customers.add({ fullName, createdAt: now, updatedAt: now })) as number;
}

const dateISO = '2026-03-10T09:00:00.000Z';

describe('saveInvoice — إنشاء فاتورة', () => {
  it('يخصم الكمية من المخزن ويحسب الإجمالي والحالة', async () => {
    const materialId = await addMaterial({ name: 'سماد يوريا', quantity: 100, salePrice: 2500 });

    const result = await saveInvoice({
      type: 'cash',
      customerName: 'زبون نقدي',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد يوريا', quantity: 3, unitPrice: 2500 }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.invoice.total).toBe(7500);
    expect(result.invoice.status).toBe('paid');
    expect(result.invoice.paidAmount).toBe(7500);
    expect(result.invoice.remaining).toBe(0);

    const material = await db.materials.get(materialId);
    expect(material?.quantity).toBe(97);

    const items = await db.invoiceItems.where('invoiceId').equals(result.invoiceId).toArray();
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(7500);
  });

  it('يرفض الحفظ عند عدم كفاية المخزون دون أي أثر جانبي', async () => {
    const materialId = await addMaterial({ name: 'مبيد', quantity: 2, salePrice: 5000 });

    const result = await saveInvoice({
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'مبيد', quantity: 10, unitPrice: 5000 }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('غير كافية');

    expect(await db.invoices.count()).toBe(0);
    expect(await db.invoiceItems.count()).toBe(0);
    expect((await db.materials.get(materialId))?.quantity).toBe(2);
  });

  it('يقيّد الخصم بحيث لا يتجاوز المجموع', async () => {
    const materialId = await addMaterial({ name: 'بذور', quantity: 10, salePrice: 1000 });

    const result = await saveInvoice({
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 99999,
      paidAmount: 0,
      items: [{ materialId, materialName: 'بذور', quantity: 2, unitPrice: 1000 }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.discount).toBe(2000);
    expect(result.invoice.total).toBe(0);
  });

  it('يرفض فاتورة آجلة بدون زبون مسجل', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 10 });
    const result = await saveInvoice({
      type: 'credit',
      customerName: 'زبون عابر',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1000 }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('زبون مسجل');
  });

  it('يرفض كمية أو سعراً غير صالح', () => {
    const base = {
      type: 'cash' as const,
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0
    };
    expect(
      validateInvoiceDraft({ ...base, items: [{ materialId: 1, materialName: 'م', quantity: 0, unitPrice: 10 }] }).ok
    ).toBe(false);
    expect(
      validateInvoiceDraft({ ...base, items: [{ materialId: 1, materialName: 'م', quantity: 1, unitPrice: -5 }] }).ok
    ).toBe(false);
    expect(validateInvoiceDraft({ ...base, items: [] }).ok).toBe(false);
  });

  it('يحسب المجاميع مع تقريب آمن للأرقام العشرية', () => {
    const totals = computeInvoiceTotals(
      [
        { materialId: 1, materialName: 'أ', quantity: 0.1, unitPrice: 3 },
        { materialId: 2, materialName: 'ب', quantity: 0.2, unitPrice: 3 }
      ],
      0
    );
    expect(totals.subtotal).toBe(0.9);
  });
});

describe('saveInvoice — تعديل فاتورة', () => {
  it('يُعيد الكمية القديمة ويخصم الجديدة دون تسريب في المخزون', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });
    const created = await saveInvoice({
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });
    if (!created.ok) throw new Error('create failed');
    expect((await db.materials.get(materialId))?.quantity).toBe(90);

    const updated = await saveInvoice({
      id: created.invoiceId,
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 25, unitPrice: 1200 }]
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.invoice.total).toBe(30000);
    expect((await db.materials.get(materialId))?.quantity).toBe(75);
    expect(await db.invoiceItems.where('invoiceId').equals(created.invoiceId).count()).toBe(1);
  });

  it('لا يُفسد المخزون إذا فشل التعديل بسبب نقص الكمية (الثغرة السابقة)', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });
    const created = await saveInvoice({
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });
    if (!created.ok) throw new Error('create failed');

    const failed = await saveInvoice({
      id: created.invoiceId,
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 500, unitPrice: 1000 }]
    });

    expect(failed.ok).toBe(false);
    // قبل الإصلاح كان المخزون يقفز إلى 100 (تسريب +10) وتُحذف البنود
    expect((await db.materials.get(materialId))?.quantity).toBe(90);
    expect(await db.invoiceItems.where('invoiceId').equals(created.invoiceId).count()).toBe(1);
    expect((await db.invoices.get(created.invoiceId))?.total).toBe(10000);
  });

  it('يُرجع الكمية كاملة عند إزالة مادة من الفاتورة أثناء التعديل', async () => {
    const first = await addMaterial({ name: 'أ', quantity: 50 });
    const second = await addMaterial({ name: 'ب', quantity: 50 });
    const created = await saveInvoice({
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [
        { materialId: first, materialName: 'أ', quantity: 5, unitPrice: 1000 },
        { materialId: second, materialName: 'ب', quantity: 7, unitPrice: 1000 }
      ]
    });
    if (!created.ok) throw new Error('create failed');

    await saveInvoice({
      id: created.invoiceId,
      type: 'cash',
      customerName: 'زبون',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId: first, materialName: 'أ', quantity: 5, unitPrice: 1000 }]
    });

    expect((await db.materials.get(first))?.quantity).toBe(45);
    expect((await db.materials.get(second))?.quantity).toBe(50);
  });
});

describe('deleteInvoice', () => {
  it('يُرجع الكميات ويحذف البنود ويحدّث رصيد الزبون', async () => {
    const customerId = await addCustomer('مدين');
    const materialId = await addMaterial({ name: 'سماد', quantity: 40 });

    const created = await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'مدين',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 8, unitPrice: 5000 }]
    });
    if (!created.ok) throw new Error('create failed');
    expect((await getCustomerBalance(customerId)).debt).toBe(40000);

    const deleted = await deleteInvoice(created.invoiceId);
    expect(deleted.ok).toBe(true);
    expect((await db.materials.get(materialId))?.quantity).toBe(40);
    expect(await db.invoiceItems.count()).toBe(0);
    expect(await db.invoices.count()).toBe(0);
    expect((await getCustomerBalance(customerId)).debt).toBe(0);
  });

  it('يرفض حذف فاتورة غير موجودة', async () => {
    const result = await deleteInvoice(9999);
    expect(result.ok).toBe(false);
  });
});

describe('أرقام الفواتير', () => {
  it('لا يكرر الرقم بعد حذف فاتورة', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });
    const first = await saveInvoice({
      type: 'cash',
      customerName: 'أ',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1000 }]
    });
    const second = await saveInvoice({
      type: 'cash',
      customerName: 'ب',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1000 }]
    });
    if (!first.ok || !second.ok) throw new Error('create failed');
    expect(first.invoiceNumber).not.toBe(second.invoiceNumber);

    await deleteInvoice(second.invoiceId);
    const thirdNumber = await nextInvoiceNumber(new Date(dateISO));
    // لا يُعاد استخدام رقم فاتورة محذوفة ما زالت نسختها الورقية متداولة
    expect(thirdNumber).not.toBe(second.invoiceNumber);
    // البادئة عربية (ف = فاتورة) — لا كلمات إنجليزية في أرقام المستندات
    expect(thirdNumber).toBe('ف-202603-0003');
  });

  it('يكمل الترقيم من الأرقام القديمة (INV-) دون تكرار رقم في الشهر نفسه', async () => {
    const now = new Date().toISOString();
    // فاتورة محفوظة بصيغة الإصدارات السابقة
    await db.invoices.add({
      invoiceNumber: 'INV-202603-0007',
      type: 'cash',
      customerName: 'زبون قديم',
      itemsCount: 0,
      subtotal: 0,
      discount: 0,
      total: 0,
      paidAmount: 0,
      remaining: 0,
      date: dateISO,
      createdAt: now,
      status: 'paid'
    });
    const next = await nextInvoiceNumber(new Date(dateISO));
    expect(next).toBe('ف-202603-0008');
  });
});

describe('الفواتير الآجلة ودفعة المقدمة', () => {
  it('ينقل الدفعة المقدمة مع الفاتورة عند تغيير الزبون ولا يخلط التسديدات', async () => {
    const firstCustomerId = await addCustomer('الزبون الأول');
    const secondCustomerId = await addCustomer('الزبون الثاني');
    const materialId = await addMaterial({ name: 'مادة النقل', quantity: 20 });
    const created = await saveInvoice({
      type: 'credit',
      customerId: firstCustomerId,
      customerName: 'الزبون الأول',
      dateISO,
      discount: 0,
      paidAmount: 4000,
      items: [{ materialId, materialName: 'مادة النقل', quantity: 5, unitPrice: 2000 }]
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await saveInvoice({
      id: created.invoiceId,
      type: 'credit',
      customerId: secondCustomerId,
      customerName: 'الزبون الثاني',
      dateISO,
      discount: 0,
      paidAmount: 3000,
      items: [{ materialId, materialName: 'مادة النقل', quantity: 5, unitPrice: 2000 }]
    });
    expect(updated.ok).toBe(true);
    expect((await db.payments.toArray())[0]).toMatchObject({
      customerId: secondCustomerId,
      amount: 3000,
      invoiceId: created.invoiceId,
      source: 'downpayment'
    });
    expect((await getCustomerBalance(firstCustomerId)).debt).toBe(0);
    expect((await getCustomerBalance(secondCustomerId)).debt).toBe(7000);
  });

  it('يسجّل دفعة المقدمة كوصل قبض ويوزع المسدد على أقدم فاتورة', async () => {
    const customerId = await addCustomer('زبون آجل');
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });

    await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'زبون آجل',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });

    const second = await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'زبون آجل',
      dateISO: '2026-03-11T09:00:00.000Z',
      discount: 0,
      paidAmount: 4000,
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });
    if (!second.ok) throw new Error('create failed');

    const payments = await db.payments.toArray();
    expect(payments).toHaveLength(1);
    expect(payments[0].source).toBe('downpayment');
    expect(payments[0].amount).toBe(4000);

    const balance = await getCustomerBalance(customerId);
    expect(balance.credit).toBe(20000);
    expect(balance.paid).toBe(4000);
    expect(balance.debt).toBe(16000);

    // التوزيع يبدأ من أقدم فاتورة
    const firstInvoice = await getInvoiceWithItems((await db.invoices.orderBy('id').first())!.id!);
    expect(firstInvoice?.invoice.paidAmount).toBe(4000);
    expect(firstInvoice?.invoice.status).toBe('partial');
    expect(second.invoice.paidAmount).toBe(0);
  });
});

describe('الرصيد السابق (الدين القديم) على الفاتورة الجديدة', () => {
  /** ينشئ فاتورة آجلة بسيطة ويعيد نتيجتها. */
  async function createCreditInvoice(args: {
    customerId: number;
    customerName: string;
    materialId: number;
    quantity: number;
    paidAmount?: number;
    dateISO?: string;
  }) {
    const result = await saveInvoice({
      type: 'credit',
      customerId: args.customerId,
      customerName: args.customerName,
      dateISO: args.dateISO ?? dateISO,
      discount: 0,
      paidAmount: args.paidAmount ?? 0,
      items: [{ materialId: args.materialId, materialName: 'سماد', quantity: args.quantity, unitPrice: 1000 }]
    });
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  it('يضيف دين الزبون القديم إلى الفاتورة الجديدة ولا يحتسبه مرتين في الرصيد', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100, salePrice: 1000 });
    const customerId = await addCustomer('أبو محمد');

    const first = await createCreditInvoice({ customerId, customerName: 'أبو محمد', materialId, quantity: 2 });
    // لا دين سابق: الحقل لا يُكتب أصلاً
    expect(first.invoice.previousBalance).toBeUndefined();

    const second = await createCreditInvoice({
      customerId,
      customerName: 'أبو محمد',
      materialId,
      quantity: 1,
      dateISO: '2026-03-11T09:00:00.000Z'
    });

    // الإجمالي يبقى قيمة الفاتورة وحدها، والدين القديم سطر مستقل عليها
    expect(second.invoice.total).toBe(1000);
    expect(second.invoice.previousBalance).toBe(2000);

    // الرصيد الفعلي = مجموع الفواتير − التسديدات (دون احتساب الدين القديم مرتين)
    const balance = await getCustomerBalance(customerId);
    expect(balance.credit).toBe(3000);
    expect(balance.debt).toBe(3000);
  });

  it('يسمح بدفعة مقدمة تسدد الدين القديم مع الفاتورة الجديدة في وصل واحد', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100, salePrice: 1000 });
    const customerId = await addCustomer('أبو محمد');

    await createCreditInvoice({ customerId, customerName: 'أبو محمد', materialId, quantity: 2 });
    const second = await createCreditInvoice({
      customerId,
      customerName: 'أبو محمد',
      materialId,
      quantity: 1,
      paidAmount: 3000,
      dateISO: '2026-03-11T09:00:00.000Z'
    });

    expect(second.invoice.previousBalance).toBe(2000);
    const payments = await db.payments.toArray();
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(3000);
    expect((await getCustomerBalance(customerId)).debt).toBe(0);

    // التوزيع على أقدم الفواتير: الفاتورتان مدفوعتان بالكامل
    const invoices = await db.invoices.orderBy('id').toArray();
    expect(invoices.map((invoice) => invoice.status)).toEqual(['paid', 'paid']);
  });

  it('يثبّت اللقطة عند التعديل ولا يعيد حسابها بعد تسديد لاحق', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100, salePrice: 1000 });
    const customerId = await addCustomer('أبو محمد');

    await createCreditInvoice({ customerId, customerName: 'أبو محمد', materialId, quantity: 2 });
    const second = await createCreditInvoice({
      customerId,
      customerName: 'أبو محمد',
      materialId,
      quantity: 1,
      dateISO: '2026-03-11T09:00:00.000Z'
    });
    expect(second.invoice.previousBalance).toBe(2000);

    // تسديد لاحق يخفض دين الزبون: لقطة الفاتورة تبقى كما سُلِّمت للزبون
    const now = new Date().toISOString();
    await db.payments.add({
      customerId,
      customerName: 'أبو محمد',
      amount: 500,
      date: now,
      method: 'cash',
      receiptNumber: 'ق-تجريبي-1',
      createdAt: now,
      source: 'manual'
    });
    await reallocateCustomerInvoices(customerId);

    const edited = await saveInvoice({
      id: second.invoiceId,
      type: 'credit',
      customerId,
      customerName: 'أبو محمد',
      dateISO: '2026-03-11T09:00:00.000Z',
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 2, unitPrice: 1000 }]
    });
    if (!edited.ok) throw new Error(edited.error);

    expect(edited.invoice.total).toBe(2000);
    expect(edited.invoice.previousBalance).toBe(2000);
    expect((await getCustomerBalance(customerId)).debt).toBe(3500);
  });

  it('يعيد حساب الرصيد السابق عند نقل الفاتورة إلى زبون آخر', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100, salePrice: 1000 });
    const firstCustomerId = await addCustomer('الزبون الأول');
    const secondCustomerId = await addCustomer('الزبون الثاني');

    await createCreditInvoice({ customerId: firstCustomerId, customerName: 'الزبون الأول', materialId, quantity: 2 });
    await createCreditInvoice({ customerId: secondCustomerId, customerName: 'الزبون الثاني', materialId, quantity: 3 });
    const moved = await createCreditInvoice({ customerId: firstCustomerId, customerName: 'الزبون الأول', materialId, quantity: 1 });
    expect(moved.invoice.previousBalance).toBe(2000);

    const transferred = await saveInvoice({
      id: moved.invoiceId,
      type: 'credit',
      customerId: secondCustomerId,
      customerName: 'الزبون الثاني',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1000 }]
    });
    if (!transferred.ok) throw new Error(transferred.error);

    // اللقطة صارت دين الزبون الجديد قبل الفاتورة، لا لقطة الزبون السابق
    expect(transferred.invoice.previousBalance).toBe(3000);
    expect((await getCustomerBalance(firstCustomerId)).debt).toBe(2000);
    expect((await getCustomerBalance(secondCustomerId)).debt).toBe(4000);
  });

  it('لا يحمّل رصيداً سابقاً على الفاتورة النقدية', async () => {
    const materialId = await addMaterial({ name: 'سماد', quantity: 100, salePrice: 1000 });
    const customerId = await addCustomer('أبو محمد');
    await createCreditInvoice({ customerId, customerName: 'أبو محمد', materialId, quantity: 2 });

    const cash = await saveInvoice({
      type: 'cash',
      customerId,
      customerName: 'أبو محمد',
      dateISO,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1000 }]
    });
    if (!cash.ok) throw new Error(cash.error);

    expect(cash.invoice.previousBalance).toBeUndefined();
    expect(cash.invoice.status).toBe('paid');
    // الدين القديم يبقى كما هو ولا يتضاعف بفاتورة نقدية
    expect((await getCustomerBalance(customerId)).debt).toBe(2000);
  });
});
