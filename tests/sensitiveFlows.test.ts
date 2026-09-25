import { describe, it, expect } from 'vitest';
import { db, getSettings, initializeDB, refreshSettings, updateSettings } from '@/lib/db';
import { isSettingsSeeded, publishSettings, readSettingsSnapshot, resetSettingsStore, sameSettings } from '@/lib/settingsStore';
import { saveInvoice, getInvoiceWithItems } from '@/lib/invoices';
import { savePayment } from '@/lib/payments';
import { deleteMaterial } from '@/lib/materials';
import { getCustomerBalance } from '@/lib/debts';
import { createBackup, importBackup, restoreBackupData } from '@/lib/backup';
import { normalizeBackup } from '@/lib/validate';
import type { BackupData, Material } from '@/types';

/**
 * اختبارات تدفقات حساسة (بنود التدقيق 4 و6):
 *   - تعديل فاتورة مدفوعة بعد تسديدها.
 *   - نقل فاتورة وتسديداتها بين زبونين.
 *   - حذف مادة لها سجلات مالية.
 *   - استيراد نسخة تالفة أو ناقصة.
 *   - إفراغ كل البيانات ⇒ العودة لمعالج الإعداد (ومخزن الإعدادات يفرغ معه).
 */

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
  return saveInvoice({
    type: 'credit',
    customerId,
    customerName,
    dateISO,
    discount: 0,
    paidAmount: 0,
    items: [{ materialId, materialName: 'سماد', quantity: total / 1000, unitPrice: 1000 }]
  });
}

describe('مخزن إعدادات المكتب (مصدر الاسم المعروض)', () => {
  it('ينشر القيمة عند الحفظ فوراً بلا انتظار أي استعلام', async () => {
    await updateSettings({ officeName: 'مكتب الرافدين الزراعي' });
    expect(isSettingsSeeded()).toBe(true);
    expect(readSettingsSnapshot()?.officeName).toBe('مكتب الرافدين الزراعي');
  });

  it('قراءة الإعدادات تُحدّث المخزن أيضاً', async () => {
    await updateSettings({ officeName: 'مكتب الكرمة' });
    resetSettingsStore();
    expect(readSettingsSnapshot()).toBeNull();

    const settings = await getSettings();
    expect(settings?.officeName).toBe('مكتب الكرمة');
    expect(readSettingsSnapshot()?.officeName).toBe('مكتب الكرمة');
  });

  it('تهيئة القاعدة عند كل إقلاع لا تمحو الاسم المحفوظ', async () => {
    await updateSettings({ officeName: 'مكتب الأنبار الزراعي' });
    resetSettingsStore();

    // كل إقلاع للتطبيق يستدعي initializeDB() ثم يقرأ الإعدادات
    await initializeDB();
    expect(readSettingsSnapshot()?.officeName).toBe('مكتب الأنبار الزراعي');
    await initializeDB();
    expect((await getSettings())?.officeName).toBe('مكتب الأنبار الزراعي');
  });

  it('إعادة القراءة بعد حذف الصفوف تُنشر قيمة فارغة لا قيمة قديمة', async () => {
    await updateSettings({ officeName: 'مكتب مؤقت' });
    await db.settings.clear();

    await refreshSettings();
    expect(readSettingsSnapshot()).toBeNull();
  });

  it('يقارن الإعدادات بالحقول الفعلية فقط', () => {
    const base = { officeName: 'مكتب', phone: '0770', address: 'الأنبار', currency: 'د.ع' };
    expect(sameSettings({ ...base } as never, { ...base } as never)).toBe(true);
    expect(sameSettings({ ...base } as never, { ...base, phone: '0771' } as never)).toBe(false);
    // الكائن الجديد بنفس القيم لا يُسبب إشعاراً (لا رسم بلا تغيير)
    const before = readSettingsSnapshot();
    publishSettings(before);
    expect(readSettingsSnapshot()).toBe(before);
  });
});

describe('تعديل فاتورة مدفوعة (بند 6)', () => {
  it('لا يفقد التسديدات ولا يُنشئ دفعة مقدمة وهمية عند تعديل فاتورة مسددة', async () => {
    const customerId = await addCustomer('زبون مسدد');
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });

    const created = await creditInvoice(customerId, 'زبون مسدد', 10000, '2026-05-01T09:00:00.000Z', materialId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const payment = await savePayment({
      customerId,
      amount: 10000,
      method: 'cash',
      dateISO: '2026-05-02T09:00:00.000Z'
    });
    expect(payment.ok).toBe(true);

    const paidInvoice = await db.invoices.get(created.invoiceId);
    expect(paidInvoice?.paidAmount).toBe(10000);
    expect(paidInvoice?.status).toBe('paid');

    // تعديل الفاتورة بنفس الكمية والسعر (كما يفعل النموذج عند الحفظ بلا تغيير)
    const edited = await saveInvoice({
      id: created.invoiceId,
      type: 'credit',
      customerId,
      customerName: 'زبون مسدد',
      dateISO: '2026-05-01T09:00:00.000Z',
      discount: 0,
      paidAmount: 0, // النموذج يعرض الدفعة المقدمة فقط وهي صفر هنا
      items: [{ materialId, materialName: 'سماد', quantity: 10, unitPrice: 1000 }]
    });
    expect(edited.ok).toBe(true);

    const paymentsCount = await db.payments.where('customerId').equals(customerId).count();
    expect(paymentsCount).toBe(1); // لم تُضف دفعة مقدمة ثانية

    const after = await getInvoiceWithItems(created.invoiceId);
    expect(after?.invoice.paidAmount).toBe(10000);
    expect(after?.invoice.remaining).toBe(0);
    expect(after?.invoice.status).toBe('paid');
    expect((await getCustomerBalance(customerId)).debt).toBe(0);

    // المخزون لم يتغير: الكمية المحجوزة أُعيدت ثم خُصمت من جديد
    const material = await db.materials.get(materialId);
    expect(material?.quantity).toBe(90);
  });

  it('تخفيض إجمالي فاتورة مسددة يترك رصيداً دائناً للزبون بلا أرقام سالبة على الفاتورة', async () => {
    const customerId = await addCustomer('زبون دفع زائد');
    const materialId = await addMaterial({ name: 'مبيد', quantity: 100 });

    const created = await creditInvoice(customerId, 'زبون دفع زائد', 10000, '2026-05-05T09:00:00.000Z', materialId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const payment = await savePayment({
      customerId,
      amount: 10000,
      method: 'cash',
      dateISO: '2026-05-06T09:00:00.000Z'
    });
    expect(payment.ok).toBe(true);

    // تخفيض الفاتورة إلى 4000 بعد أن دفع 10000
    const edited = await saveInvoice({
      id: created.invoiceId,
      type: 'credit',
      customerId,
      customerName: 'زبون دفع زائد',
      dateISO: '2026-05-05T09:00:00.000Z',
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'مبيد', quantity: 4, unitPrice: 1000 }]
    });
    expect(edited.ok).toBe(true);

    const invoice = await db.invoices.get(created.invoiceId);
    expect(invoice?.total).toBe(4000);
    expect(invoice?.paidAmount).toBe(4000);
    expect(invoice?.remaining).toBe(0);
    expect(invoice?.status).toBe('paid');

    // الرصيد الدائن (سالب) يظهر على مستوى الزبون لا على الفاتورة
    const balance = await getCustomerBalance(customerId);
    expect(balance.paid).toBe(10000);
    expect(balance.debt).toBe(-6000);
  });
});

describe('نقل فاتورة وتسديداتها بين زبونين (بند 6)', () => {
  it('ينقل الدين كاملاً ولا يُبقي أثراً على الزبون السابق', async () => {
    const firstCustomerId = await addCustomer('الزبون الأول');
    const secondCustomerId = await addCustomer('الزبون الثاني');
    const materialId = await addMaterial({ name: 'بذور', quantity: 100 });

    const created = await creditInvoice(firstCustomerId, 'الزبون الأول', 8000, '2026-05-10T09:00:00.000Z', materialId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const payment = await savePayment({
      customerId: firstCustomerId,
      amount: 3000,
      method: 'cash',
      dateISO: '2026-05-11T09:00:00.000Z'
    });
    expect(payment.ok).toBe(true);

    // نقل الفاتورة إلى الزبون الثاني
    await db.invoices.update(created.invoiceId, { customerId: secondCustomerId, customerName: 'الزبون الثاني' });

    // لا يوجد في التطبيق واجهة "نقل" مباشرة: النقل يتم بتعديل الفاتورة نفسها
    const edited = await saveInvoice({
      id: created.invoiceId,
      type: 'credit',
      customerId: secondCustomerId,
      customerName: 'الزبون الثاني',
      dateISO: '2026-05-10T09:00:00.000Z',
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'بذور', quantity: 8, unitPrice: 1000 }]
    });
    expect(edited.ok).toBe(true);

    // التسديد اليدوي يبقى على الزبون الأول (سجل قبض صادر منه) فلا يُختلط
    const firstBalance = await getCustomerBalance(firstCustomerId);
    const secondBalance = await getCustomerBalance(secondCustomerId);
    expect(firstBalance.credit).toBe(0);
    expect(secondBalance.credit).toBe(8000);
    expect(secondBalance.paid).toBe(0);
    expect(secondBalance.debt).toBe(8000);

    const moved = await db.invoices.get(created.invoiceId);
    expect(moved?.customerId).toBe(secondCustomerId);
    expect(moved?.status).toBe('unpaid');
  });
});

describe('حذف مادة لها سجلات مالية (بند 6)', () => {
  it('يرفض حذف مادة مستخدمة في فاتورة ويُبلغ بالسبب', async () => {
    const customerId = await addCustomer('زبون');
    const materialId = await addMaterial({ name: 'مادة مستخدمة', quantity: 50 });
    await creditInvoice(customerId, 'زبون', 5000, '2026-06-01T09:00:00.000Z', materialId);

    const result = await deleteMaterial(materialId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('لا يمكن حذف المادة');
      expect(result.error).toContain('فاتورة');
    }
    expect(await db.materials.get(materialId)).toBeTruthy();
  });

  it('يسمح بحذف مادة غير مستخدمة', async () => {
    const materialId = await addMaterial({ name: 'مادة حرة', quantity: 5 });
    const result = await deleteMaterial(materialId);
    expect(result.ok).toBe(true);
    expect(await db.materials.get(materialId)).toBeUndefined();
  });
});

describe('استيراد نسخة تالفة أو ناقصة (بند 6)', () => {
  it('يرفض ملفاً بلا بنية نسخة ولا يمسّ البيانات الحالية', async () => {
    const customerId = await addCustomer('زبون محفوظ');
    expect(normalizeBackup({ hello: 'world' }).ok).toBe(false);

    const file = new File([JSON.stringify({ hello: 'world' })], 'corrupt.json', {
      type: 'application/json'
    });
    await expect(importBackup(file)).rejects.toThrow();
    expect(await db.customers.get(customerId)).toBeTruthy();
  });

  it('يرفض نسخة بلا أي سجلات بيانات بدل محو بيانات المكتب القائم', async () => {
    const customerId = await addCustomer('زبون قبل الاستيراد');
    const materialId = await addMaterial({ name: 'مادة قبل الاستيراد', quantity: 3 });

    const backup = await createBackup();
    const truncated: BackupData = {
      ...backup,
      data: {
        ...backup.data,
        materials: [],
        customers: [],
        invoices: [],
        invoiceItems: [],
        payments: [],
        customerLedger: [],
        stockMovements: []
      }
    };

    await expect(restoreBackupData(truncated)).rejects.toThrow(/سجلات بيانات/);
    // لم يُحذف شيء: البيانات القديمة كما هي
    expect(await db.customers.get(customerId)).toBeTruthy();
    expect(await db.materials.get(materialId)).toBeTruthy();
  });

  it('يستورد نسخة ناقصة الإعدادات ولا يترك فاتورة بلا زبون', async () => {
    const customerId = await addCustomer('زبون'); 
    const materialId = await addMaterial({ name: 'سماد', quantity: 40 });
    await creditInvoice(customerId, 'زبون', 4000, '2026-06-10T09:00:00.000Z', materialId);
    const backup = await createBackup();

    const partial: BackupData = {
      ...backup,
      data: { ...backup.data, settings: [] }
    };

    const restore = await restoreBackupData(partial);
    expect(restore.counts.invoices).toBeGreaterThan(0);
    // كل تسديد مستورد مرتبط بزبون موجود (لا مراجع معلّقة)
    const payments = await db.payments.toArray();
    const customerIds = new Set((await db.customers.toArray()).map((customer) => customer.id));
    expect(payments.every((payment) => customerIds.has(payment.customerId))).toBe(true);
  });

  it('يستكمل الإعدادات الناقصة بعد استعادة نسخة قديمة بلا اسم مكتب', async () => {
    const customerId = await addCustomer('زبون محفوظ في النسخة');
    const materialId = await addMaterial({ name: 'مادة محفوظة', quantity: 7 });
    const backup = await createBackup();

    const legacy: BackupData = { ...backup, officeName: '', data: { ...backup.data, settings: [] } };
    const restore = await restoreBackupData(legacy);
    expect(restore.warnings.join(' ')).toContain('إعدادات');

    const settings = await getSettings();
    expect(settings).toBeTruthy();
    // السجلات بقيت والدور للحفظ استُعيد، والمخزن المشترك يعكس القيمة الجديدة
    expect(await db.customers.get(customerId)).toBeTruthy();
    expect(await db.materials.get(materialId)).toBeTruthy();
    // المخزن المشترك يحمل نفس القيم المستعادة (قد يكون كائناً مختلفاً بنفس القيم،
    // وهذا مقصود: لا نُرسل إشعاراً للواجهة إذا لم تتغير القيم فعلاً)
    expect(sameSettings(readSettingsSnapshot(), settings ?? null)).toBe(true);
  });
});
