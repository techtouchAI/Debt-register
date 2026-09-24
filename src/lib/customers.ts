import { logBackgroundFailure } from './lifecycle';
import { assertPermission } from './session';
import { db, logActivity } from './db';
import { roundMoney, toFiniteNumber } from './utils';
import type { Customer } from '@/types';

/**
 * عمليات الزبائن الموحّدة.
 *
 * سبب وجود هذه الوحدة: كان التحقق من صحة بيانات الزبون ومنع حذف زبون له
 * سجلات مالية مكتوباً داخل مكوّن الشاشة، فلا يمكن اختباره ولا إعادة استخدامه
 * في أي مسار آخر. هنا يصبح المنع قاعدة عمل واحدة قابلة للاختبار، ويبقى
 * المكوّن مسؤولاً عن العرض فقط.
 *
 * قاعدة السلامة المالية: لا يُحذف زبون له أي حركة مالية (فاتورة أو تسديد)،
 * لأن حذفه يفسد كشوف الحساب والتقارير التي تعتمد على معرّفه.
 */

export interface CustomerInput {
  fullName: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export type CustomerSaveResult =
  | { ok: true; customer: Customer; id: number }
  | { ok: false; error: string };

export interface CustomerDeletionBlock {
  ok: false;
  reason: 'not-found' | 'has-debt' | 'has-records';
  /** المتبقي على الزبون (قد يكون صفراً أو سالباً عند الدفع الزائد) */
  debt: number;
  invoices: number;
  payments: number;
}

export type CustomerDeletionCheck = { ok: true; customer: Customer } | CustomerDeletionBlock;
export type CustomerDeleteResult = CustomerDeletionCheck;

export const MAX_CUSTOMER_NAME_LENGTH = 150;

export function validateCustomerInput(
  input: Partial<CustomerInput>
): { ok: true; value: CustomerInput } | { ok: false; error: string } {
  const fullName = (input.fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!fullName) return { ok: false, error: 'اسم الزبون مطلوب' };
  if (fullName.length > MAX_CUSTOMER_NAME_LENGTH) {
    return { ok: false, error: `اسم الزبون طويل جداً (${MAX_CUSTOMER_NAME_LENGTH} حرفاً كحد أقصى)` };
  }

  const optional = (value?: string): string | undefined => {
    const trimmed = (value ?? '').trim();
    return trimmed ? trimmed : undefined;
  };

  const phone = optional(input.phone);
  if (phone && !/^[\d+*#\s()/-]{3,25}$/.test(phone)) {
    return { ok: false, error: 'رقم الهاتف يحتوي على رموز غير صالحة' };
  }

  return {
    ok: true,
    value: { fullName, phone, address: optional(input.address), notes: optional(input.notes) }
  };
}

/**
 * إنشاء زبون جديد أو تحديث زبون موجود.
 *  - `id` موجود ⇒ تحديث (يرفض المعرّف غير الموجود بدل الكتابة الصامتة).
 *  - `createdAt` الأصلي يُحفظ عند التحديث.
 */
export async function saveCustomer(input: Partial<CustomerInput>, id?: number): Promise<CustomerSaveResult> {
  const isEdit = Number.isInteger(id) && (id as number) > 0;
  assertPermission(isEdit ? 'customers.edit' : 'customers.create');

  const validation = validateCustomerInput(input);
  if (!validation.ok) return validation;

  const now = new Date().toISOString();

  const result = await db.transaction('rw', [db.customers], async (): Promise<CustomerSaveResult> => {
    if (isEdit) {
      const existing = await db.customers.get(id as number);
      if (!existing) return { ok: false, error: 'الزبون المطلوب تعديله غير موجود' };

      const customer: Customer = {
        ...existing,
        ...validation.value,
        createdAt: existing.createdAt ?? now,
        updatedAt: now
      };
      await db.customers.update(id as number, customer);
      return { ok: true, customer, id: id as number };
    }

    const customer: Customer = { ...validation.value, createdAt: now, updatedAt: now };
    const newId = (await db.customers.add(customer)) as number;
    return { ok: true, customer: { ...customer, id: newId }, id: newId };
  });

  if (result.ok) {
    const verb = isEdit ? 'تعديل' : 'إضافة';
    await logActivity(
      `${verb} زبون`,
      isEdit
        ? `تم تعديل بيانات الزبون: ${result.customer.fullName}`
        : `تمت إضافة زبون جديد: ${result.customer.fullName}`,
      'customer',
      result.id
    ).catch((error) => logBackgroundFailure('تعذّر تسجيل نشاط الزبون:', error));
  }

  return result;
}

/**
 * فحص إمكانية حذف الزبون دون حذف — يُستخدم لعرض السبب قبل تأكيد المستخدم.
 * الحذف الفعلي يعيد الفحص داخل معاملة واحدة (`deleteCustomer`) فلا توجد فجوة
 * زمنية بين الفحص والحذف.
 */
export async function checkCustomerDeletion(customerId: number): Promise<CustomerDeletionCheck> {
  if (!Number.isInteger(customerId) || customerId <= 0) return blocked('not-found', 0, 0, 0);
  return inspectDeletion(customerId);
}

/**
 * حذف زبون بعد التأكد من عدم وجود أي أثر مالي له.
 * يُعاد السبب (`reason`) بدل رسالة جاهزة لتُصاغ الرسالة في الواجهة، ويبقى
 * المنع قابلاً للاختبار.
 */
export async function deleteCustomer(customerId: number): Promise<CustomerDeleteResult> {
  assertPermission('customers.delete');
  if (!Number.isInteger(customerId) || customerId <= 0) return blocked('not-found', 0, 0, 0);

  const outcome = await db.transaction('rw', [db.customers, db.invoices, db.payments], async () => {
    const check = await inspectDeletion(customerId);
    if (!check.ok) return check;
    await db.customers.delete(customerId);
    return check;
  });

  if (outcome.ok) {
    await logActivity('حذف زبون', `تم حذف الزبون: ${outcome.customer.fullName}`, 'customer', customerId).catch((error) =>
      logBackgroundFailure('تعذّر تسجيل النشاط:', error)
    );
  }

  return outcome;
}

function blocked(
  reason: CustomerDeletionBlock['reason'],
  debt: number,
  invoices: number,
  payments: number
): CustomerDeletionBlock {
  return { ok: false, reason, debt, invoices, payments };
}

/** الفحص الفعلي: يعمل داخل معاملة إن وُجدت، أو مستقلاً إن لم توجد. */
async function inspectDeletion(customerId: number): Promise<CustomerDeletionCheck> {
  const customer = await db.customers.get(customerId);
  if (!customer) return blocked('not-found', 0, 0, 0);

  const [invoices, payments] = await Promise.all([
    db.invoices.where('customerId').equals(customerId).toArray(),
    db.payments.where('customerId').equals(customerId).toArray()
  ]);

  const credit = roundMoney(
    invoices.reduce((sum, invoice) => (invoice.type === 'credit' ? sum + toFiniteNumber(invoice.total) : sum), 0)
  );
  const paid = roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));
  const debt = roundMoney(credit - paid);

  if (debt > 0) return blocked('has-debt', debt, invoices.length, payments.length);
  if (invoices.length > 0 || payments.length > 0) {
    return blocked('has-records', debt, invoices.length, payments.length);
  }

  return { ok: true, customer };
}
