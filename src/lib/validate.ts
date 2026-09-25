import type {
  ActivityLog,
  AppMeta,
  BackupCounts,
  BackupData,
  BackupIntegrity,
  Customer,
  CustomerLedger,
  Invoice,
  InvoiceItem,
  Material,
  Notification as AppNotification,
  OfficeSettings,
  Payment,
  StockMovement,
  User
} from '@/types';
import { DEFAULT_SETTINGS } from './db';
import { toFiniteNumber } from './utils';
import { DOCUMENT_PREFIX } from './labels';
import { isPortableMetaKey } from './metaKeys';

/**
 * فحص Schema للنسخ الاحتياطية قبل لمس قاعدة البيانات. لا نعامل ملف النسخة
 * كمدخل موثوق: القيم المحاسبية غير المنطقية ترفض الملف بدلاً من تحويلها
 * بصمت إلى أصفار أو استعادة بيانات مشوهة.
 */
export type ValidationResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : value == null ? fallback : String(value));
const asBoolean = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback);
const asId = (value: unknown): number | undefined => {
  const id = toFiniteNumber(value, NaN);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};
const asDate = (value: unknown, fallback: string): string => {
  const parsed = new Date(asString(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
};
const requiredDate = (value: unknown, label: string): string => {
  const parsed = new Date(asString(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}: التاريخ غير صالح`);
  return parsed.toISOString();
};
const finite = (value: unknown, label: string, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = toFiniteNumber(value, NaN);
  if (!Number.isFinite(number)) throw new Error(`${label}: القيمة الرقمية غير صالحة`);
  return number;
};
const nonNegative = (value: unknown, label: string, fallback?: number): number => {
  const number = finite(value, label, fallback);
  if (number < 0) throw new Error(`${label}: لا يقبل قيمة سالبة`);
  return number;
};

function sanitizeSettings(rows: unknown[]): OfficeSettings[] {
  const row = rows.find(isRecord);
  if (!row) return [{ ...DEFAULT_SETTINGS }];
  return [{
    ...DEFAULT_SETTINGS,
    officeName: asString(row.officeName, DEFAULT_SETTINGS.officeName),
    phone: asString(row.phone),
    address: asString(row.address),
    logo: typeof row.logo === 'string' ? row.logo : undefined,
    currency: asString(row.currency, DEFAULT_SETTINGS.currency),
    lowStockThreshold: nonNegative(row.lowStockThreshold, 'الإعدادات/حد المخزون', DEFAULT_SETTINGS.lowStockThreshold),
    theme: row.theme === 'dark' || row.theme === 'auto' ? row.theme : 'light',
    autoBackupEnabled: asBoolean(row.autoBackupEnabled, DEFAULT_SETTINGS.autoBackupEnabled),
    autoBackupInterval: nonNegative(row.autoBackupInterval, 'الإعدادات/فترة النسخ', DEFAULT_SETTINGS.autoBackupInterval),
    lastBackup: typeof row.lastBackup === 'string' ? row.lastBackup : undefined,
    language: asString(row.language, DEFAULT_SETTINGS.language),
    invoiceFooter: asString(row.invoiceFooter, DEFAULT_SETTINGS.invoiceFooter),
    taxNumber: typeof row.taxNumber === 'string' ? row.taxNumber : undefined
  }];
}

function sanitizeUsers(rows: unknown[], now: string): User[] {
  const names = new Set<string>();
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`المستخدم ${index + 1}: سجل غير صالح`);
    const name = asString(row.name).trim();
    if (!name) throw new Error(`المستخدم ${index + 1}: الاسم مطلوب`);
    const key = name.toLocaleLowerCase('ar');
    if (names.has(key)) throw new Error(`المستخدم ${index + 1}: الاسم مكرر`);
    names.add(key);
    return {
      id: asId(row.id),
      name,
      role: row.role === 'admin' ? 'admin' : 'sales',
      // الحسابات القديمة قد تكون بلا PIN لأن القفل أصبح اختيارياً.
      pin: typeof row.pin === 'string' ? row.pin : '',
      createdAt: asDate(row.createdAt, now),
      lastLogin: typeof row.lastLogin === 'string' ? row.lastLogin : undefined
    } satisfies User;
  });
}

function sanitizeMaterials(rows: unknown[], now: string): Material[] {
  const names = new Set<string>();
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`المادة ${index + 1}: سجل غير صالح`);
    const name = asString(row.name).trim();
    if (!name) throw new Error(`المادة ${index + 1}: الاسم مطلوب`);
    const key = name.toLocaleLowerCase('ar');
    if (names.has(key)) throw new Error(`المادة ${index + 1}: الاسم مكرر`);
    names.add(key);
    const legacyCost = row.averageCost ?? row.purchasePrice;
    const createdAt = asDate(row.createdAt, now);
    return {
      id: asId(row.id),
      name,
      quantity: nonNegative(row.quantity, `المادة ${name}/الكمية`, 0),
      salePrice: nonNegative(row.salePrice, `المادة ${name}/سعر البيع`, 0),
      averageCost: nonNegative(legacyCost, `المادة ${name}/متوسط التكلفة`, 0),
      lastCost: row.lastCost === undefined && legacyCost === undefined ? undefined : nonNegative(row.lastCost ?? legacyCost, `المادة ${name}/آخر تكلفة`),
      category: asString(row.category) || 'عام',
      barcode: asString(row.barcode) || undefined,
      minQuantity: nonNegative(row.minQuantity, `المادة ${name}/الحد الأدنى`, 0),
      unit: asString(row.unit) || 'قطعة',
      description: asString(row.description) || undefined,
      createdAt,
      updatedAt: asDate(row.updatedAt, createdAt)
    } satisfies Material;
  });
}

function sanitizeCustomers(rows: unknown[], now: string): Customer[] {
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`الزبون ${index + 1}: سجل غير صالح`);
    const fullName = asString(row.fullName).trim();
    if (!fullName) throw new Error(`الزبون ${index + 1}: الاسم مطلوب`);
    const createdAt = asDate(row.createdAt, now);
    return {
      id: asId(row.id), fullName, phone: asString(row.phone) || undefined, address: asString(row.address) || undefined,
      notes: asString(row.notes) || undefined, createdAt, updatedAt: asDate(row.updatedAt, createdAt)
    } satisfies Customer;
  });
}

function sanitizeInvoices(rows: unknown[], now: string): Invoice[] {
  const numbers = new Set<string>();
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`الفاتورة ${index + 1}: سجل غير صالح`);
    const invoiceNumber = asString(row.invoiceNumber).trim() || `${DOCUMENT_PREFIX.invoice}-مستعاد-${index + 1}`;
    if (numbers.has(invoiceNumber)) throw new Error(`رقم الفاتورة مكرر: ${invoiceNumber}`);
    numbers.add(invoiceNumber);
    const type = row.type === 'cash' ? 'cash' : 'credit';
    const total = nonNegative(row.total, `الفاتورة ${invoiceNumber}/الإجمالي`, 0);
    const paidAmount = nonNegative(row.paidAmount, `الفاتورة ${invoiceNumber}/المدفوع`, type === 'cash' ? total : 0);
    const remaining = nonNegative(row.remaining, `الفاتورة ${invoiceNumber}/المتبقي`, Math.max(0, total - paidAmount));
    if (type === 'credit' && !asId(row.customerId)) throw new Error(`الفاتورة الآجلة ${invoiceNumber} بلا زبون صالح`);
    const date = asDate(row.date, now);
    return {
      id: asId(row.id), invoiceNumber, type, customerId: asId(row.customerId), customerName: asString(row.customerName, 'زبون غير معروف'),
      itemsCount: nonNegative(row.itemsCount, `الفاتورة ${invoiceNumber}/عدد البنود`, 0),
      subtotal: nonNegative(row.subtotal, `الفاتورة ${invoiceNumber}/المجموع`, total),
      discount: nonNegative(row.discount, `الفاتورة ${invoiceNumber}/الخصم`, 0), total, paidAmount, remaining,
      date, createdAt: asDate(row.createdAt, date), notes: asString(row.notes) || undefined,
      status: row.status === 'paid' || row.status === 'partial' || row.status === 'unpaid' ? row.status : remaining <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
      updatedAt: typeof row.updatedAt === 'string' ? asDate(row.updatedAt, date) : undefined,
      downPaymentId: asId(row.downPaymentId),
      previousBalance: row.previousBalance === undefined ? undefined : nonNegative(row.previousBalance, `الفاتورة ${invoiceNumber}/الرصيد السابق`)
    } satisfies Invoice;
  });
}

function sanitizeInvoiceItems(rows: unknown[]): InvoiceItem[] {
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`بند الفاتورة ${index + 1}: سجل غير صالح`);
    const invoiceId = asId(row.invoiceId), materialId = asId(row.materialId);
    if (!invoiceId || !materialId) throw new Error(`بند الفاتورة ${index + 1}: مرجع الفاتورة أو المادة غير صالح`);
    const quantity = finite(row.quantity, `بند الفاتورة ${index + 1}/الكمية`);
    if (quantity <= 0) throw new Error(`بند الفاتورة ${index + 1}: الكمية يجب أن تكون أكبر من صفر`);
    const unitPrice = nonNegative(row.unitPrice, `بند الفاتورة ${index + 1}/السعر`);
    return {
      id: asId(row.id), invoiceId, materialId, materialName: asString(row.materialName, 'مادة'), quantity, unitPrice,
      total: nonNegative(row.total, `بند الفاتورة ${index + 1}/الإجمالي`, quantity * unitPrice),
      unitCost: row.unitCost === undefined && row.purchasePrice === undefined ? undefined : nonNegative(row.unitCost ?? row.purchasePrice, `بند الفاتورة ${index + 1}/التكلفة`)
    } satisfies InvoiceItem;
  });
}

function sanitizePayments(rows: unknown[], now: string): Payment[] {
  const numbers = new Set<string>();
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`التسديد ${index + 1}: سجل غير صالح`);
    const customerId = asId(row.customerId);
    if (!customerId) throw new Error(`التسديد ${index + 1}: الزبون غير صالح`);
    const receiptNumber = asString(row.receiptNumber).trim() || `${DOCUMENT_PREFIX.receipt}-مستعاد-${index + 1}`;
    if (numbers.has(receiptNumber)) throw new Error(`رقم وصل القبض مكرر: ${receiptNumber}`);
    numbers.add(receiptNumber);
    const amount = finite(row.amount, `التسديد ${receiptNumber}/المبلغ`);
    if (amount <= 0) throw new Error(`التسديد ${receiptNumber}: المبلغ يجب أن يكون أكبر من صفر`);
    const date = asDate(row.date, now);
    return {
      id: asId(row.id), customerId, customerName: asString(row.customerName, 'زبون غير معروف'), amount, date,
      method: row.method === 'transfer' || row.method === 'other' ? row.method : 'cash', receiptNumber,
      remainingAfter: row.remainingAfter === undefined ? undefined : nonNegative(row.remainingAfter, `التسديد ${receiptNumber}/المتبقي`),
      notes: asString(row.notes) || undefined, createdAt: asDate(row.createdAt, date),
      source: row.source === 'downpayment' ? 'downpayment' : 'manual', invoiceId: asId(row.invoiceId)
    } satisfies Payment;
  });
}

function sanitizeCustomerLedger(rows: unknown[], now: string): CustomerLedger[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`حركة الذمم ${index + 1}: سجل غير صالح`);
    const customerId = asId(row.customerId), referenceId = asId(row.referenceId);
    const type = row.type;
    if (!customerId || !referenceId || (type !== 'invoice' && type !== 'payment' && type !== 'discount')) throw new Error(`حركة الذمم ${index + 1}: المرجع أو النوع غير صالح`);
    const amount = finite(row.amount, `حركة الذمم ${index + 1}/المبلغ`);
    if (amount === 0 || (type === 'invoice' && amount < 0) || (type === 'payment' && amount > 0)) throw new Error(`حركة الذمم ${index + 1}: اتجاه المبلغ لا يطابق نوع الحركة`);
    const key = `${type}:${referenceId}`;
    if (seen.has(key)) throw new Error(`حركة الذمم ${index + 1}: مرجع مكرر`);
    seen.add(key);
    return { id: asId(row.id), customerId, date: requiredDate(row.date, `حركة الذمم ${index + 1}`), type, amount, referenceId,
      notes: asString(row.notes) || undefined, createdAt: asDate(row.createdAt, now), updatedAt: typeof row.updatedAt === 'string' ? asDate(row.updatedAt, now) : undefined } satisfies CustomerLedger;
  });
}

function sanitizeStockMovements(rows: unknown[], now: string): StockMovement[] {
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`حركة المخزون ${index + 1}: سجل غير صالح`);
    const materialId = asId(row.materialId), type = row.type;
    if (!materialId || (type !== 'manual_entry' && type !== 'sale' && type !== 'adjustment')) throw new Error(`حركة المخزون ${index + 1}: المادة أو النوع غير صالح`);
    const quantity = finite(row.quantity, `حركة المخزون ${index + 1}/الكمية`);
    if (quantity === 0 || (type === 'sale' && quantity > 0) || (type === 'manual_entry' && quantity < 0)) throw new Error(`حركة المخزون ${index + 1}: اتجاه الكمية لا يطابق نوع الحركة`);
    return { id: asId(row.id), materialId, date: requiredDate(row.date, `حركة المخزون ${index + 1}`), quantity,
      cost: nonNegative(row.cost, `حركة المخزون ${index + 1}/التكلفة`), type, referenceId: asId(row.referenceId),
      notes: asString(row.notes) || undefined, createdAt: asDate(row.createdAt, now) } satisfies StockMovement;
  });
}

function sanitizeNotifications(rows: unknown[], now: string): AppNotification[] {
  return rows.filter(isRecord).map((row) => ({
    id: asId(row.id), title: asString(row.title, 'إشعار'), message: asString(row.message),
    type: row.type === 'warning' || row.type === 'error' || row.type === 'success' ? row.type : 'info', isRead: asBoolean(row.isRead),
    createdAt: asDate(row.createdAt, now), relatedId: asId(row.relatedId),
    relatedType: row.relatedType === 'material' || row.relatedType === 'customer' || row.relatedType === 'invoice' || row.relatedType === 'payment' || row.relatedType === 'system' ? row.relatedType : undefined,
    code: typeof row.code === 'string' ? row.code : undefined
  } satisfies AppNotification));
}

function sanitizeActivityLogs(rows: unknown[], now: string): ActivityLog[] {
  return rows.filter(isRecord).map((row) => ({ id: asId(row.id), action: asString(row.action, 'إجراء'), details: asString(row.details), timestamp: asDate(row.timestamp, now), entityType: asString(row.entityType) || undefined, entityId: asId(row.entityId), userId: asId(row.userId), userName: asString(row.userName) || undefined }));
}

function sanitizeMeta(rows: unknown[]): AppMeta[] {
  const seen = new Set<string>();
  return rows.filter(isRecord).flatMap((row) => {
    if (!isPortableMetaKey(row.key) || seen.has(row.key)) return [];
    seen.add(row.key);
    return [{ key: row.key, value: row.value }];
  });
}

function sanitizeCounts(value: unknown): BackupCounts | undefined {
  if (!isRecord(value)) return undefined;
  const counts: BackupCounts = {};
  for (const [key, raw] of Object.entries(value)) {
    const count = toFiniteNumber(raw, NaN);
    if (Number.isInteger(count) && count >= 0) (counts as Record<string, number>)[key] = count;
  }
  return Object.keys(counts).length ? counts : undefined;
}
function sanitizeIntegrity(value: unknown): BackupIntegrity | undefined {
  return isRecord(value) && value.algorithm === 'SHA-256' && typeof value.hash === 'string' && /^[0-9a-f]{64}$/i.test(value.hash) ? { algorithm: 'SHA-256', hash: value.hash.toLowerCase() } : undefined;
}

function reconcileReferences(data: BackupData['data'], warnings: string[], requireCompleteLedger = false): void {
  const customers = new Set(data.customers.map((row) => row.id).filter((id): id is number => id !== undefined));
  const materials = new Set(data.materials.map((row) => row.id).filter((id): id is number => id !== undefined));
  const invoices = new Map(data.invoices.filter((row): row is Invoice & { id: number } => typeof row.id === 'number').map((row) => [row.id, row]));
  const payments = new Map(data.payments.filter((row): row is Payment & { id: number } => typeof row.id === 'number').map((row) => [row.id, row]));

  for (const item of data.invoiceItems) {
    if (!invoices.has(item.invoiceId) || !materials.has(item.materialId)) {
      throw new Error(`بند الفاتورة ${item.id ?? item.invoiceId}: يشير إلى فاتورة أو مادة غير موجودة`);
    }
  }
  for (const payment of data.payments) {
    if (!customers.has(payment.customerId)) throw new Error(`التسديد ${payment.receiptNumber}: يشير إلى زبون غير موجود`);
    if (payment.invoiceId !== undefined && !invoices.has(payment.invoiceId)) {
      throw new Error(`التسديد ${payment.receiptNumber}: الفاتورة المرتبطة غير موجودة`);
    }
  }
  for (const entry of data.customerLedger ?? []) {
    if (!customers.has(entry.customerId)) throw new Error('دفتر الذمم: حركة تشير إلى زبون غير موجود');
    if (entry.type === 'invoice') {
      const invoice = invoices.get(entry.referenceId as number);
      if (!invoice || invoice.customerId !== entry.customerId || Math.abs(entry.amount - invoice.total) > 0.01) {
        throw new Error('دفتر الذمم: حركة فاتورة لا تطابق مصدرها');
      }
    }
    if (entry.type === 'payment') {
      const payment = payments.get(entry.referenceId as number);
      if (!payment || payment.customerId !== entry.customerId || Math.abs(entry.amount + payment.amount) > 0.01) {
        throw new Error('دفتر الذمم: حركة تسديد لا تطابق مصدرها');
      }
    }
  }
  for (const movement of data.stockMovements ?? []) {
    if (!materials.has(movement.materialId)) throw new Error('حركة المخزون: تشير إلى مادة غير موجودة');
    if (movement.type === 'sale' && (!movement.referenceId || !invoices.has(movement.referenceId))) {
      throw new Error('حركة المخزون: حركة البيع لا تشير إلى فاتورة موجودة');
    }
  }

  // ملفات الإصدار الحالي تعلن دفتر الذمم صراحةً؛ لذلك لا نسمح بملف مبتور
  // يترك فاتورة أو تسديداً بلا قيد مقابل. النسخ الأقدم التي لا تعلن الجدول
  // تُرقّى لاحقاً بقيود مستمدة من مصادرها الأصلية فقط.
  if (requireCompleteLedger) {
    const ledgerKeys = new Set((data.customerLedger ?? []).map((entry) => `${entry.type}:${entry.referenceId}`));
    for (const invoice of data.invoices) {
      if (invoice.type === 'credit' && invoice.id && !ledgerKeys.has(`invoice:${invoice.id}`)) {
        throw new Error(`دفتر الذمم: الفاتورة ${invoice.invoiceNumber} بلا قيد مقابل`);
      }
    }
    for (const payment of data.payments) {
      if (payment.id && !ledgerKeys.has(`payment:${payment.id}`)) {
        throw new Error(`دفتر الذمم: التسديد ${payment.receiptNumber} بلا قيد مقابل`);
      }
    }
  }
  if (data.invoiceItems.length === 0 && invoices.size > 0) warnings.push('لا تحتوي النسخة على بنود فواتير صالحة لبعض الفواتير');
}

function buildLegacyLedger(data: BackupData['data'], now: string): CustomerLedger[] {
  const rows: CustomerLedger[] = [];
  for (const invoice of data.invoices) if (invoice.type === 'credit' && invoice.customerId && invoice.id) rows.push({ customerId: invoice.customerId, date: invoice.date, type: 'invoice', amount: invoice.total, referenceId: invoice.id, notes: `ترحيل فاتورة ${invoice.invoiceNumber}`, createdAt: now });
  for (const payment of data.payments) if (payment.id) rows.push({ customerId: payment.customerId, date: payment.date, type: 'payment', amount: -payment.amount, referenceId: payment.id, notes: `ترحيل تسديد ${payment.receiptNumber}`, createdAt: now });
  return rows;
}
function buildOpeningMovements(data: BackupData['data'], now: string): StockMovement[] {
  return data.materials.filter((material): material is Material & { id: number } => typeof material.id === 'number' && material.quantity !== 0).map((material) => ({ materialId: material.id, date: material.updatedAt || material.createdAt || now, quantity: material.quantity, cost: material.averageCost, type: 'manual_entry', notes: 'رصيد افتتاحي من نسخة سابقة', createdAt: now }));
}

export function normalizeBackup(input: unknown): ValidationResult<BackupData> {
  try {
    if (!isRecord(input) || !isRecord(input.data)) return { ok: false, error: 'الملف ليس نسخة احتياطية صالحة: قسم البيانات مفقود' };
    const data = input.data, now = new Date().toISOString(), warnings: string[] = [];
    const declaresLedger = Object.prototype.hasOwnProperty.call(data, 'customerLedger');
    if (!Array.isArray(data.settings) || data.settings.length === 0) warnings.push('لم تتضمن النسخة إعدادات؛ ستُنشأ إعدادات افتراضية ويظهر معالج الإعداد');
    const normalized: BackupData = {
      version: asString(input.version, '2.0.0'), date: asDate(input.date, now), officeName: asString(input.officeName) || undefined,
      appVersion: asString(input.appVersion) || undefined, counts: sanitizeCounts(input.counts), integrity: sanitizeIntegrity(input.integrity),
      data: {
        settings: sanitizeSettings(toArray(data.settings)), users: sanitizeUsers(toArray(data.users), now), materials: sanitizeMaterials(toArray(data.materials), now), customers: sanitizeCustomers(toArray(data.customers), now), invoices: sanitizeInvoices(toArray(data.invoices), now), invoiceItems: sanitizeInvoiceItems(toArray(data.invoiceItems)), payments: sanitizePayments(toArray(data.payments), now),
        customerLedger: sanitizeCustomerLedger(toArray(data.customerLedger), now), stockMovements: sanitizeStockMovements(toArray(data.stockMovements), now), notifications: sanitizeNotifications(toArray(data.notifications), now), activityLogs: sanitizeActivityLogs(toArray(data.activityLogs), now), meta: sanitizeMeta(toArray(data.meta))
      }
    };
    reconcileReferences(normalized.data, warnings, declaresLedger);
    if (!declaresLedger && !normalized.data.customerLedger?.length) {
      normalized.data.customerLedger = buildLegacyLedger(normalized.data, now);
      if (normalized.data.customerLedger.length) warnings.push('تم إنشاء دفتر ذمم من الفواتير والتسديدات القديمة');
    }
    if (!normalized.data.stockMovements?.length) {
      normalized.data.stockMovements = buildOpeningMovements(normalized.data, now);
      if (normalized.data.stockMovements.length) warnings.push('تم إنشاء حركات افتتاحية للمخزون من أرصدة المواد الحالية');
    }
    return { ok: true, value: normalized, warnings };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'تعذر التحقق من بنية النسخة الاحتياطية' };
  }
}

/** قراءة ملف JSON مع حد يمنع استنزاف الذاكرة قبل التحقق. */
export function readBackupFile(file: File, maxBytes = 200 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new Error('حجم الملف أكبر من الحد المسموح (200 ميجابايت)'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.onload = () => { try { resolve(JSON.parse(String(reader.result))); } catch { reject(new Error('الملف ليس نسخة احتياطية صالحة أو أنه تالف')); } };
    reader.readAsText(file);
  });
}
