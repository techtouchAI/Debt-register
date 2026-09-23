import { logBackgroundFailure } from './lifecycle';
import { db, logActivity, createNotification, checkLowStock, getSettingsOrDefault } from './db';
import { nextInvoiceNumber, nextReceiptNumber } from './sequence';
import { formatCurrency, roundMoney, toFiniteNumber } from './utils';
import type { Invoice, InvoiceItem } from '@/types';

export interface InvoiceDraftItem {
  materialId: number;
  materialName: string;
  quantity: number;
  unitPrice: number;
  purchasePrice?: number;
}

export interface InvoiceDraft {
  /** معرّف الفاتورة عند التعديل */
  id?: number;
  type: 'cash' | 'credit';
  customerId?: number;
  customerName: string;
  /** تاريخ بصيغة ISO */
  dateISO: string;
  discount: number;
  /** المدفوع الآن (للفواتير الآجلة فقط) */
  paidAmount: number;
  notes?: string;
  items: InvoiceDraftItem[];
}

export type InvoiceSaveResult =
  | {
      ok: true;
      invoiceId: number;
      invoiceNumber: string;
      invoice: Invoice;
      items: InvoiceItem[];
    }
  | { ok: false; error: string };

export type InvoiceDeleteResult = { ok: true } | { ok: false; error: string };

export interface InvoiceWithItems {
  invoice: Invoice;
  items: InvoiceItem[];
}

/* ------------------------------------------------------------------ *
 * التحقق من صحة المسودة
 * ------------------------------------------------------------------ */

export function validateInvoiceDraft(draft: InvoiceDraft): { ok: true } | { ok: false; error: string } {
  const customerName = (draft.customerName ?? '').trim();
  if (!customerName) return { ok: false, error: 'يرجى إدخال اسم الزبون' };
  if (!Array.isArray(draft.items) || draft.items.length === 0) return { ok: false, error: 'يرجى إضافة مواد للفاتورة' };
  if (draft.type !== 'cash' && draft.type !== 'credit') return { ok: false, error: 'نوع الفاتورة غير صالح' };
  if (draft.type === 'credit' && (!Number.isInteger(draft.customerId) || (draft.customerId as number) <= 0)) {
    return { ok: false, error: 'الفواتير الآجلة يجب أن ترتبط بزبون مسجل' };
  }
  if (typeof draft.dateISO !== 'string' || !Number.isFinite(new Date(draft.dateISO).getTime())) {
    return { ok: false, error: 'تاريخ الفاتورة غير صالح' };
  }
  const discount = toFiniteNumber(draft.discount, NaN);
  if (!Number.isFinite(discount) || discount < 0) {
    return { ok: false, error: 'قيمة الخصم غير صالحة' };
  }
  const paidAmount = toFiniteNumber(draft.paidAmount, NaN);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    return { ok: false, error: 'قيمة الدفعة المقدمة غير صالحة' };
  }

  for (const item of draft.items) {
    if (!Number.isInteger(item.materialId) || item.materialId <= 0) return { ok: false, error: 'أحد المواد غير مرتبطة بالمخزن' };
    const quantity = toFiniteNumber(item.quantity, NaN);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `الكمية غير صالحة للمادة "${item.materialName || item.materialId}"` };
    }
    const unitPrice = toFiniteNumber(item.unitPrice, NaN);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { ok: false, error: `السعر غير صالح للمادة "${item.materialName || item.materialId}"` };
    }
  }

  return { ok: true };
}

/** حساب مجاميع الفاتورة مع تقريب آمن ومنع القيم السالبة. */
export function computeInvoiceTotals(items: InvoiceDraftItem[], discount: number) {
  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + roundMoney(toFiniteNumber(item.quantity) * toFiniteNumber(item.unitPrice)), 0)
  );
  const safeDiscount = Math.min(Math.max(roundMoney(toFiniteNumber(discount)), 0), subtotal);
  const total = roundMoney(subtotal - safeDiscount);
  return { subtotal, discount: safeDiscount, total };
}

export function invoiceStatusFor(total: number, paid: number): Invoice['status'] {
  if (total <= 0 || total - paid <= 0.009) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/* ------------------------------------------------------------------ *
 * توزيع المسددات على الفواتير الآجلة (أقدم فاتورة أولاً)
 * ------------------------------------------------------------------ */

/**
 * إعادة حساب "المدفوع/المتبقي/الحالة" لكل فواتير الزبون الآجلة انطلاقاً
 * من مجموع تسديداته الفعلية. العملية قابلة للتكرار (idempotent) ولا تعتمد
 * على قيم مخزنة قد تتلف، وتُستدعى بعد أي فاتورة أو تسديد أو حذف.
 */
export async function reallocateCustomerInvoices(customerId: number): Promise<void> {
  if (typeof customerId !== 'number') return;

  const invoices = (await db.invoices.where('customerId').equals(customerId).toArray()).filter(
    (invoice) => invoice.type === 'credit'
  );
  if (invoices.length === 0) return;

  invoices.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  const payments = await db.payments.where('customerId').equals(customerId).toArray();
  let pool = roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));
  const now = new Date().toISOString();

  for (const invoice of invoices) {
    if (invoice.id === undefined) continue;
    const total = roundMoney(toFiniteNumber(invoice.total));
    const allocated = Math.max(0, Math.min(pool, total));
    pool = roundMoney(pool - allocated);
    const remaining = roundMoney(total - allocated);
    await db.invoices.update(invoice.id, {
      paidAmount: allocated,
      remaining,
      status: invoiceStatusFor(total, allocated),
      updatedAt: now
    });
  }
}

/* ------------------------------------------------------------------ *
 * القراءة
 * ------------------------------------------------------------------ */

export async function getInvoiceWithItems(invoiceId: number): Promise<InvoiceWithItems | null> {
  const invoice = await db.invoices.get(invoiceId);
  if (!invoice) return null;
  const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
  return { invoice, items };
}

/* ------------------------------------------------------------------ *
 * الحفظ (إنشاء أو تعديل) داخل معاملة واحدة
 * ------------------------------------------------------------------ */

export async function saveInvoice(draft: InvoiceDraft): Promise<InvoiceSaveResult> {
  const validation = validateInvoiceDraft(draft);
  if (!validation.ok) return validation;

  const isEdit = Number.isInteger(draft.id) && (draft.id as number) > 0;
  const customerName = draft.customerName.trim();
  const { subtotal, discount, total } = computeInvoiceTotals(draft.items, draft.discount);
  const dateISO = new Date(draft.dateISO).toISOString();

  // db.meta ضمن النطاق لأن مولّد الأرقام التسلسلية يحفظ علامته فيه
  const result = await db.transaction(
    'rw',
    [db.invoices, db.invoiceItems, db.materials, db.payments, db.customers, db.meta],
    async (): Promise<InvoiceSaveResult> => {
      const now = new Date().toISOString();

      if (draft.customerId !== undefined) {
        if (!Number.isInteger(draft.customerId) || draft.customerId <= 0) {
          return { ok: false, error: 'معرّف الزبون غير صالح' };
        }
        const linkedCustomer = await db.customers.get(draft.customerId);
        if (!linkedCustomer) return { ok: false, error: 'الزبون المرتبط بالفاتورة غير موجود' };
      }

      const existing = isEdit ? await db.invoices.get(draft.id as number) : undefined;
      if (isEdit && !existing) return { ok: false, error: 'الفاتورة المطلوب تعديلها غير موجودة' };

      /* --- 1) تجميع الكميات المطلوبة والكميات السابقة لهذه الفاتورة --- */
      const requested = new Map<number, number>();
      for (const item of draft.items) {
        requested.set(item.materialId, roundMoney((requested.get(item.materialId) ?? 0) + toFiniteNumber(item.quantity)));
      }

      const previousItems = isEdit
        ? await db.invoiceItems.where('invoiceId').equals(draft.id as number).toArray()
        : [];
      const previous = new Map<number, number>();
      for (const item of previousItems) {
        previous.set(item.materialId, roundMoney((previous.get(item.materialId) ?? 0) + toFiniteNumber(item.quantity)));
      }

      /* --- 2) التحقق من توفر المخزون قبل أي كتابة --- */
      const materialIds = Array.from(new Set([...requested.keys(), ...previous.keys()]));
      const materials = await db.materials.bulkGet(materialIds);
      const stockById = new Map<number, { id: number; name: string; quantity: number }>();
      for (const material of materials) {
        if (material?.id !== undefined) {
          stockById.set(material.id, {
            id: material.id,
            name: material.name,
            quantity: toFiniteNumber(material.quantity)
          });
        }
      }

      const deltas = new Map<number, number>();
      for (const [materialId, quantity] of requested) {
        const stock = stockById.get(materialId);
        const draftItem = draft.items.find((item) => item.materialId === materialId);
        const label = stock?.name ?? draftItem?.materialName ?? String(materialId);
        if (!stock) return { ok: false, error: `المادة "${label}" غير موجودة في المخزن` };

        const reserved = previous.get(materialId) ?? 0;
        const available = roundMoney(stock.quantity + reserved);
        if (quantity > available) {
          return {
            ok: false,
            error: `المادة "${label}" كميتها غير كافية. المطلوب: ${quantity}، المتوفر: ${available}`
          };
        }
        deltas.set(materialId, roundMoney((deltas.get(materialId) ?? 0) + reserved - quantity));
      }

      // مواد كانت في الفاتورة قبل التعديل ولم تعد ضمنها → إرجاع كامل الكمية
      for (const [materialId, quantity] of previous) {
        if (requested.has(materialId)) continue;
        if (!stockById.has(materialId)) continue;
        deltas.set(materialId, roundMoney((deltas.get(materialId) ?? 0) + quantity));
      }

      /* --- 3) كتابة بنود الفاتورة --- */
      if (isEdit) {
        await db.invoiceItems.where('invoiceId').equals(draft.id as number).delete();
      }

      const invoiceNumber =
        isEdit && existing?.invoiceNumber ? existing.invoiceNumber : await nextInvoiceNumber(new Date(dateISO));

      const requestedPaid = roundMoney(toFiniteNumber(draft.paidAmount));
      const downPayment = draft.type === 'credit' ? Math.max(0, Math.min(requestedPaid, total)) : 0;

      let invoiceId = draft.id as number;
      const { id: _existingId, ...existingFields } = existing ?? {};
      const invoiceRecord: Invoice = {
        ...existingFields,
        invoiceNumber,
        type: draft.type,
        customerId: draft.customerId,
        customerName,
        itemsCount: draft.items.length,
        subtotal,
        discount,
        total,
        paidAmount: draft.type === 'cash' ? total : 0,
        remaining: draft.type === 'cash' ? 0 : total,
        date: dateISO,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        notes: draft.notes?.trim() ? draft.notes.trim() : undefined,
        status: draft.type === 'cash' ? 'paid' : invoiceStatusFor(total, 0),
        downPaymentId: existing?.downPaymentId
      };

      if (isEdit) {
        await db.invoices.update(invoiceId, invoiceRecord);
      } else {
        invoiceId = (await db.invoices.add(invoiceRecord)) as number;
      }

      const savedItems: InvoiceItem[] = [];
      for (const item of draft.items) {
        const lineTotal = roundMoney(toFiniteNumber(item.quantity) * toFiniteNumber(item.unitPrice));
        const record: InvoiceItem = {
          invoiceId,
          materialId: item.materialId,
          materialName: item.materialName,
          quantity: roundMoney(toFiniteNumber(item.quantity)),
          unitPrice: roundMoney(toFiniteNumber(item.unitPrice)),
          total: lineTotal,
          purchasePrice: Number.isFinite(toFiniteNumber(item.purchasePrice, NaN))
            ? toFiniteNumber(item.purchasePrice)
            : undefined
        };
        record.id = (await db.invoiceItems.add(record)) as number;
        savedItems.push(record);
      }

      /* --- 4) تطبيق فروق المخزون دفعة واحدة (بدون قراءات متكررة) --- */
      for (const [materialId, delta] of deltas) {
        const stock = stockById.get(materialId);
        if (!stock) continue;
        await db.materials.update(materialId, {
          quantity: roundMoney(stock.quantity + delta),
          updatedAt: now
        });
      }

      /* --- 5) إدارة دفعة المقدمة كسجل قبض حقيقي --- */
      await syncDownPayment({
        invoiceId,
        invoiceNumber,
        customerId: draft.customerId,
        customerName,
        dateISO,
        downPayment,
        existingDownPaymentId: existing?.downPaymentId,
        type: draft.type
      });

      /* --- 6) إعادة توزيع المسددات على كل الزبائن المتأثرين --- */
      // يلزم ذلك حتى عند تحويل فاتورة آجلة إلى نقدية، أو نقلها من زبون
      // لآخر؛ وإلا يبقى رصيد الفاتورة القديمة مخزناً على الزبون السابق.
      const affectedCustomerIds = new Set<number>();
      if (typeof draft.customerId === 'number') affectedCustomerIds.add(draft.customerId);
      if (isEdit && typeof existing?.customerId === 'number') affectedCustomerIds.add(existing.customerId);
      for (const customerId of affectedCustomerIds) {
        await reallocateCustomerInvoices(customerId);
      }

      const saved = (await db.invoices.get(invoiceId)) as Invoice;
      return { ok: true, invoiceId, invoiceNumber, invoice: saved, items: savedItems };
    }
  );

  /* --- آثار جانبية بعد نجاح المعاملة فقط --- */
  if (result.ok) {
    const settings = await getSettingsOrDefault();
    const verb = isEdit ? 'تعديل' : 'إنشاء';
    await logActivity(
      `${verb} فاتورة`,
      `تم ${verb} الفاتورة ${result.invoiceNumber} للزبون ${customerName} بمبلغ ${formatCurrency(total, settings.currency)}`,
      'invoice',
      result.invoiceId
    ).catch((error) => logBackgroundFailure('تعذّر تسجيل النشاط:', error));

    if (draft.type === 'credit' && total > 500000) {
      await createNotification(
        'فاتورة آجلة كبيرة',
        `فاتورة ${result.invoiceNumber} بمبلغ ${formatCurrency(total, settings.currency)} للزبون ${customerName}`,
        { type: 'info', relatedId: result.invoiceId, relatedType: 'invoice', code: 'large-credit-invoice' }
      ).catch((error) => logBackgroundFailure('تعذّر إنشاء الإشعار:', error));
    }

    await checkLowStock().catch((error) => logBackgroundFailure('تعذّر فحص المخزون:', error));
  }

  return result;
}

/**
 * مزامنة دفعة المقدمة مع سجل التسديدات:
 *  - فاتورة نقدية أو دفعة صفرية ← لا سجل قبض
 *  - فاتورة آجلة بدفعة ← سجل قبض قابل للظهور في التقارير والطباعة
 */
async function syncDownPayment(args: {
  invoiceId: number;
  invoiceNumber: string;
  customerId?: number;
  customerName: string;
  dateISO: string;
  downPayment: number;
  existingDownPaymentId?: number;
  type: 'cash' | 'credit';
}): Promise<void> {
  const {
    invoiceId,
    invoiceNumber,
    customerId,
    customerName,
    dateISO,
    downPayment,
    existingDownPaymentId,
    type
  } = args;

  const shouldKeep = type === 'credit' && downPayment > 0 && typeof customerId === 'number';

  if (!shouldKeep) {
    if (existingDownPaymentId !== undefined) {
      const linked = await db.payments.get(existingDownPaymentId);
      if (linked?.source === 'downpayment') await db.payments.delete(existingDownPaymentId);
    }
    // لا نترك مرجعاً ميتاً إذا كانت النسخة القديمة تشير إلى سجل قبض
    // محذوف أو تغيّر نوع الفاتورة إلى نقدية.
    await db.invoices.update(invoiceId, { downPaymentId: undefined });
    return;
  }

  const notes = `دفعة مقدمة على الفاتورة ${invoiceNumber}`;

  if (existingDownPaymentId !== undefined) {
    const linked = await db.payments.get(existingDownPaymentId);
    if (linked?.source === 'downpayment' && linked.invoiceId === invoiceId) {
      await db.payments.update(existingDownPaymentId, {
        customerId: customerId as number,
        customerName,
        amount: downPayment,
        date: dateISO,
        notes,
        createdAt: linked.createdAt,
        source: 'downpayment',
        invoiceId
      });
      return;
    }
  }

  const receiptNumber = await nextReceiptNumber(new Date(dateISO));
  const paymentId = (await db.payments.add({
    customerId: customerId as number,
    customerName,
    amount: downPayment,
    date: dateISO,
    method: 'cash',
    receiptNumber,
    notes,
    createdAt: new Date().toISOString(),
    source: 'downpayment',
    invoiceId
  })) as number;

  await db.invoices.update(invoiceId, { downPaymentId: paymentId });
}

/* ------------------------------------------------------------------ *
 * الحذف
 * ------------------------------------------------------------------ */

export async function deleteInvoice(invoiceId: number): Promise<InvoiceDeleteResult> {
  let affectedCustomerIds: number[] = [];
  let invoiceNumber = '';

  const result = await db.transaction(
    'rw',
    [db.invoices, db.invoiceItems, db.materials, db.payments],
    async (): Promise<InvoiceDeleteResult> => {
      const invoice = await db.invoices.get(invoiceId);
      if (!invoice) return { ok: false, error: 'الفاتورة غير موجودة' };
      invoiceNumber = invoice.invoiceNumber;

      const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();

      /* إرجاع الكميات للمخزن داخل نفس المعاملة */
      const restorations = new Map<number, number>();
      for (const item of items) {
        restorations.set(
          item.materialId,
          roundMoney((restorations.get(item.materialId) ?? 0) + toFiniteNumber(item.quantity))
        );
      }
      const materials = await db.materials.bulkGet(Array.from(restorations.keys()));
      for (const material of materials) {
        if (!material?.id) continue;
        const restore = restorations.get(material.id) ?? 0;
        await db.materials.update(material.id, {
          quantity: roundMoney(toFiniteNumber(material.quantity) + restore),
          updatedAt: new Date().toISOString()
        });
      }

      /* حذف دفعة المقدمة المرتبطة إن وُجدت */
      if (invoice.downPaymentId !== undefined) {
        const linked = await db.payments.get(invoice.downPaymentId);
        if (linked?.source === 'downpayment') await db.payments.delete(invoice.downPaymentId);
      }

      await db.invoiceItems.where('invoiceId').equals(invoiceId).delete();
      await db.invoices.delete(invoiceId);

      affectedCustomerIds = typeof invoice.customerId === 'number' ? [invoice.customerId] : [];
      return { ok: true };
    }
  );

  if (!result.ok) return result;

  for (const customerId of new Set(affectedCustomerIds)) {
    await reallocateCustomerInvoices(customerId);
  }

  await logActivity('حذف فاتورة', `تم حذف الفاتورة: ${invoiceNumber}`, 'invoice', invoiceId).catch((error) =>
    logBackgroundFailure('تعذّر تسجيل النشاط:', error)
  );
  await checkLowStock().catch((error) => logBackgroundFailure('تعذّر فحص المخزون:', error));

  return { ok: true };
}
