import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import {
  MAX_CUSTOMER_NAME_LENGTH,
  checkCustomerDeletion,
  deleteCustomer,
  saveCustomer,
  validateCustomerInput
} from '@/lib/customers';
import { saveInvoice } from '@/lib/invoices';
import { savePayment } from '@/lib/payments';
import type { Material } from '@/types';

/**
 * حمايات الزبائن — أحد بنود التدقيق: منع حذف زبون له سجلات مالية، ومنع
 * إدخال بيانات غير صالحة. كانت هذه القواعد داخل مكوّن الشاشة فقط، فصارت هنا
 * في طبقة عمل قابلة للاختبار، ويعيد الحذف الفحص داخل معاملة واحدة.
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

async function addCustomer(fullName = 'زبون اختبار'): Promise<number> {
  const created = await saveCustomer({ fullName });
  if (!created.ok) throw new Error(created.error);
  return created.id;
}

describe('التحقق من بيانات الزبون', () => {
  it('يرفض الاسم الفارغ ويطبّع الفراغات ولا يقتطع الاسم الطويل', () => {
    expect(validateCustomerInput({ fullName: '   ' }).ok).toBe(false);

    const longName = `${'مكتب الرافدين الزراعي لتجارة البذور والأسمدة والمبيدات '.repeat(3)}`;
    expect(longName.length).toBeGreaterThan(MAX_CUSTOMER_NAME_LENGTH);
    const tooLong = validateCustomerInput({ fullName: longName });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain(`${MAX_CUSTOMER_NAME_LENGTH}`);

    const normalized = validateCustomerInput({ fullName: '  علي   حسن \n الجبوري ' });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.value.fullName).toBe('علي حسن الجبوري');
  });

  it('يرفض رقم هاتف برموز غير صالحة ويقبل الأرقام والرموز المسموحة', () => {
    expect(validateCustomerInput({ fullName: 'زبون', phone: '07701234567' }).ok).toBe(true);
    expect(validateCustomerInput({ fullName: 'زبون', phone: '+964 770-123 4567' }).ok).toBe(true);
    expect(validateCustomerInput({ fullName: 'زبون', phone: 'abc' }).ok).toBe(false);
    expect(validateCustomerInput({ fullName: 'زبون', phone: '0770<script>' }).ok).toBe(false);
  });
});

describe('حفظ الزبائن', () => {
  it('ينشئ زبوناً ويحدّثه دون فقدان تاريخ الإنشاء', async () => {
    const created = await saveCustomer({ fullName: 'حسن الزراعي', phone: '0770' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = await db.customers.get(created.id);
    expect(before?.fullName).toBe('حسن الزراعي');

    const updated = await saveCustomer({ fullName: 'حسن الزراعي الجديد' }, created.id);
    expect(updated.ok).toBe(true);
    const after = await db.customers.get(created.id);
    expect(after?.fullName).toBe('حسن الزراعي الجديد');
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });

  it('يرفض تعديل زبون غير موجود بدل الكتابة الصامتة', async () => {
    const result = await saveCustomer({ fullName: 'زبون وهمي' }, 999999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('غير موجود');
  });
});

describe('منع حذف زبون له سجلات مالية', () => {
  it('يرفض الحذف لوجود فاتورة آجلة ويكشف السبب والمبلغ', async () => {
    const customerId = await addCustomer('مدين');
    const materialId = await addMaterial({ name: 'سماد', quantity: 100 });

    const invoice = await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'مدين',
      dateISO: '2026-04-01T09:00:00.000Z',
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 4, unitPrice: 2500 }]
    });
    expect(invoice.ok).toBe(true);

    const check = await checkCustomerDeletion(customerId);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe('has-debt');
      expect(check.debt).toBe(10000);
      expect(check.invoices).toBe(1);
    }

    const deletion = await deleteCustomer(customerId);
    expect(deletion.ok).toBe(false);
    if (!deletion.ok) expect(deletion.reason).toBe('has-debt');
    // لم يُحذف الزبون ولا فواتيره
    expect(await db.customers.get(customerId)).toBeTruthy();
    expect(await db.invoices.where('customerId').equals(customerId).count()).toBe(1);
  });

  it('يرفض الحذف لوجود تسديد سابق حتى لو كان الرصيد صفراً', async () => {
    const customerId = await addCustomer('مسدد');
    const materialId = await addMaterial({ name: 'يوريا', quantity: 100 });

    const invoice = await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'مسدد',
      dateISO: '2026-04-02T09:00:00.000Z',
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'يوريا', quantity: 2, unitPrice: 5000 }]
    });
    expect(invoice.ok).toBe(true);

    const payment = await savePayment({
      customerId,
      amount: 10000,
      method: 'cash',
      dateISO: '2026-04-03T09:00:00.000Z'
    });
    expect(payment.ok).toBe(true);

    const check = await checkCustomerDeletion(customerId);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      // الرصيد صفر لكن السجل المالي قائم: الحذف يفسد كشف الحساب
      expect(check.reason).toBe('has-records');
      expect(check.debt).toBe(0);
      expect(check.payments).toBe(1);
    }
  });

  it('يسمح بحذف زبون بلا أي حركة مالية', async () => {
    const customerId = await addCustomer('زبون بلا حركة');

    const check = await checkCustomerDeletion(customerId);
    expect(check.ok).toBe(true);

    const deletion = await deleteCustomer(customerId);
    expect(deletion.ok).toBe(true);
    if (deletion.ok) expect(deletion.customer.fullName).toBe('زبون بلا حركة');
    expect(await db.customers.get(customerId)).toBeUndefined();
  });

  it('يرفض الحذف بمعرّف غير صالح أو زبون غير موجود', async () => {
    expect((await deleteCustomer(0)).ok).toBe(false);
    expect((await deleteCustomer(987654)).ok).toBe(false);
    const check = await checkCustomerDeletion(987654);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('not-found');
  });

  it('يسجّل عملية الحذف في سجل النشاط', async () => {
    const customerId = await addCustomer('زبون مرحّل');
    await deleteCustomer(customerId);

    const logs = await db.activityLogs.toArray();
    const deletion = logs.filter((log) => log.action === 'حذف زبون');
    expect(deletion.some((log) => log.details.includes('زبون مرحّل'))).toBe(true);
  });
});
