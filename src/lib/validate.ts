import type {
  ActivityLog,
  Notification as AppNotification,
  BackupData,
  Customer,
  Invoice,
  InvoiceItem,
  Material,
  OfficeSettings,
  Payment,
  User
} from '@/types';
import { DEFAULT_SETTINGS } from './db';
import { toFiniteNumber } from './utils';

/**
 * التحقق من صحة ملف النسخة الاحتياطية قبل الكتابة في قاعدة البيانات.
 *
 * لماذا هو ضروري:
 *  - ملف تالف أو غير مطابق كان يُمسح البيانات الحالية ثم يفشل الاستيراد.
 *  - الملف مصدر خارجي غير موثوق؛ أي حقل غير متوقع قد يُعطّل الشاشات لاحقاً
 *    (مثلاً كمية نصية تكسر كل حسابات المخزون).
 */

export type ValidationResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);

const asNumber = (value: unknown, fallback = 0): number => toFiniteNumber(value, fallback);

const asBoolean = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback);

const asDate = (value: unknown, fallback: string): string => {
  const raw = asString(value);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

const asId = (value: unknown): number | undefined => {
  const id = asNumber(value, NaN);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : undefined;
};

const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function sanitizeSettings(rows: unknown[]): OfficeSettings[] {
  const row = rows.find(isRecord);
  if (!row) return [{ ...DEFAULT_SETTINGS }];
  // المعرّف يُترك للتوليد التلقائي حتى لا يتعارض مع سجل موجود
  return [
    {
      ...DEFAULT_SETTINGS,
      officeName: asString(row.officeName, DEFAULT_SETTINGS.officeName),
      phone: asString(row.phone),
      address: asString(row.address),
      logo: typeof row.logo === 'string' ? row.logo : undefined,
      currency: asString(row.currency, DEFAULT_SETTINGS.currency),
      lowStockThreshold: asNumber(row.lowStockThreshold, DEFAULT_SETTINGS.lowStockThreshold),
      theme: row.theme === 'dark' || row.theme === 'auto' ? row.theme : 'light',
      autoBackupEnabled: asBoolean(row.autoBackupEnabled, DEFAULT_SETTINGS.autoBackupEnabled),
      autoBackupInterval: asNumber(row.autoBackupInterval, DEFAULT_SETTINGS.autoBackupInterval),
      lastBackup: typeof row.lastBackup === 'string' ? row.lastBackup : undefined,
      language: asString(row.language, DEFAULT_SETTINGS.language),
      invoiceFooter: asString(row.invoiceFooter, DEFAULT_SETTINGS.invoiceFooter),
      taxNumber: typeof row.taxNumber === 'string' ? row.taxNumber : undefined
    }
  ];
}

function sanitizeUsers(rows: unknown[], now: string, warnings: string[]): User[] {
  const users: User[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل سجل مستخدم غير صالح');
      continue;
    }
    const name = asString(row.name).trim();
    if (!name) {
      warnings.push('تم تجاهل مستخدم بدون اسم');
      continue;
    }
    users.push({
      id: asId(row.id),
      name,
      role: row.role === 'admin' ? 'admin' : 'sales',
      pin: asString(row.pin, '0000'),
      createdAt: asDate(row.createdAt, now),
      lastLogin: typeof row.lastLogin === 'string' ? row.lastLogin : undefined
    });
  }
  return users;
}

function sanitizeMaterials(rows: unknown[], now: string, warnings: string[]): Material[] {
  const materials: Material[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل سجل مادة غير صالح');
      continue;
    }
    const name = asString(row.name).trim();
    if (!name) {
      warnings.push('تم تجاهل مادة بدون اسم');
      continue;
    }
    const createdAt = asDate(row.createdAt, now);
    materials.push({
      id: asId(row.id),
      name,
      quantity: asNumber(row.quantity),
      salePrice: asNumber(row.salePrice),
      purchasePrice: row.purchasePrice === undefined ? undefined : asNumber(row.purchasePrice),
      category: asString(row.category) || 'عام',
      barcode: asString(row.barcode) || undefined,
      minQuantity: asNumber(row.minQuantity),
      unit: asString(row.unit) || 'قطعة',
      description: asString(row.description) || undefined,
      createdAt,
      updatedAt: asDate(row.updatedAt, createdAt)
    });
  }
  return materials;
}

function sanitizeCustomers(rows: unknown[], now: string, warnings: string[]): Customer[] {
  const customers: Customer[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل سجل زبون غير صالح');
      continue;
    }
    const fullName = asString(row.fullName).trim();
    if (!fullName) {
      warnings.push('تم تجاهل زبون بدون اسم');
      continue;
    }
    const createdAt = asDate(row.createdAt, now);
    customers.push({
      id: asId(row.id),
      fullName,
      phone: asString(row.phone) || undefined,
      address: asString(row.address) || undefined,
      notes: asString(row.notes) || undefined,
      createdAt,
      updatedAt: asDate(row.updatedAt, createdAt)
    });
  }
  return customers;
}

function sanitizeInvoices(rows: unknown[], now: string, warnings: string[]): Invoice[] {
  const invoices: Invoice[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل سجل فاتورة غير صالح');
      continue;
    }
    const total = asNumber(row.total);
    const subtotal = asNumber(row.subtotal, total);
    const discount = asNumber(row.discount);
    const paidAmount = asNumber(row.paidAmount);
    const remaining = asNumber(row.remaining, Math.max(0, total - paidAmount));
    const date = asDate(row.date, now);
    const type = row.type === 'cash' ? 'cash' : 'credit';
    const status: Invoice['status'] =
      row.status === 'paid' || row.status === 'partial' || row.status === 'unpaid'
        ? row.status
        : remaining <= 0
          ? 'paid'
          : paidAmount > 0
            ? 'partial'
            : 'unpaid';

    invoices.push({
      id: asId(row.id),
      invoiceNumber: asString(row.invoiceNumber) || `INV-RESTORED-${invoices.length + 1}`,
      type,
      customerId: asId(row.customerId),
      customerName: asString(row.customerName, 'زبون غير معروف'),
      itemsCount: asNumber(row.itemsCount),
      subtotal,
      discount,
      total,
      paidAmount,
      remaining,
      date,
      createdAt: asDate(row.createdAt, date),
      notes: asString(row.notes) || undefined,
      status,
      downPaymentId: asId(row.downPaymentId)
    });
  }
  return invoices;
}

function sanitizeInvoiceItems(rows: unknown[], warnings: string[]): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل بند فاتورة غير صالح');
      continue;
    }
    const invoiceId = asId(row.invoiceId);
    const materialId = asId(row.materialId);
    if (invoiceId === undefined || materialId === undefined) {
      warnings.push('تم تجاهل بند فاتورة بلا ربط صحيح');
      continue;
    }
    const quantity = asNumber(row.quantity);
    const unitPrice = asNumber(row.unitPrice);
    items.push({
      id: asId(row.id),
      invoiceId,
      materialId,
      materialName: asString(row.materialName, 'مادة'),
      quantity,
      unitPrice,
      total: asNumber(row.total, quantity * unitPrice),
      purchasePrice: row.purchasePrice === undefined ? undefined : asNumber(row.purchasePrice)
    });
  }
  return items;
}

function sanitizePayments(rows: unknown[], now: string, warnings: string[]): Payment[] {
  const payments: Payment[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push('تم تجاهل سجل تسديد غير صالح');
      continue;
    }
    const customerId = asId(row.customerId);
    if (customerId === undefined) {
      warnings.push('تم تجاهل تسديد بلا زبون');
      continue;
    }
    const date = asDate(row.date, now);
    payments.push({
      id: asId(row.id),
      customerId,
      customerName: asString(row.customerName, 'زبون'),
      amount: asNumber(row.amount),
      date,
      method: row.method === 'transfer' || row.method === 'other' ? row.method : 'cash',
      receiptNumber: asString(row.receiptNumber) || `REC-RESTORED-${payments.length + 1}`,
      remainingAfter: row.remainingAfter === undefined ? undefined : asNumber(row.remainingAfter),
      notes: asString(row.notes) || undefined,
      createdAt: asDate(row.createdAt, date),
      source: row.source === 'downpayment' ? 'downpayment' : 'manual',
      invoiceId: asId(row.invoiceId)
    });
  }
  return payments;
}

function sanitizeNotifications(rows: unknown[], now: string): AppNotification[] {
  const notifications: AppNotification[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const type =
      row.type === 'warning' || row.type === 'error' || row.type === 'success' ? row.type : 'info';
    const relatedType =
      row.relatedType === 'material' ||
      row.relatedType === 'customer' ||
      row.relatedType === 'invoice' ||
      row.relatedType === 'payment' ||
      row.relatedType === 'system'
        ? row.relatedType
        : undefined;
    notifications.push({
      id: asId(row.id),
      title: asString(row.title, 'إشعار'),
      message: asString(row.message),
      type,
      isRead: asBoolean(row.isRead),
      createdAt: asDate(row.createdAt, now),
      relatedId: asId(row.relatedId),
      relatedType,
      code: typeof row.code === 'string' ? row.code : undefined
    });
  }
  return notifications;
}

function sanitizeActivityLogs(rows: unknown[], now: string): ActivityLog[] {
  const logs: ActivityLog[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    logs.push({
      id: asId(row.id),
      action: asString(row.action, 'إجراء'),
      details: asString(row.details),
      timestamp: asDate(row.timestamp, now),
      entityType: asString(row.entityType) || undefined,
      entityId: asId(row.entityId)
    });
  }
  return logs;
}

export function normalizeBackup(input: unknown): ValidationResult<BackupData> {
  if (!isRecord(input)) {
    return { ok: false, error: 'الملف ليس نسخة احتياطية صالحة (بنية JSON غير متوقعة)' };
  }

  const data = isRecord(input.data) ? input.data : null;
  if (!data) {
    return { ok: false, error: 'الملف لا يحتوي على قسم البيانات (data)' };
  }

  const warnings: string[] = [];
  const now = new Date().toISOString();

  const settingsRows = toArray(data.settings);
  if (settingsRows.length === 0) {
    warnings.push('لم تحتوي النسخة على إعدادات، تم استخدام القيم الافتراضية');
  }

  const backup: BackupData = {
    version: asString(input.version, '1.0.0'),
    date: asDate(input.date, now),
    officeName: asString(input.officeName) || undefined,
    data: {
      settings: sanitizeSettings(settingsRows),
      users: sanitizeUsers(toArray(data.users), now, warnings),
      materials: sanitizeMaterials(toArray(data.materials), now, warnings),
      customers: sanitizeCustomers(toArray(data.customers), now, warnings),
      invoices: sanitizeInvoices(toArray(data.invoices), now, warnings),
      invoiceItems: sanitizeInvoiceItems(toArray(data.invoiceItems), warnings),
      payments: sanitizePayments(toArray(data.payments), now, warnings),
      notifications: sanitizeNotifications(toArray(data.notifications), now),
      activityLogs: sanitizeActivityLogs(toArray(data.activityLogs), now)
    }
  };

  const hasAnyData =
    backup.data.materials.length > 0 ||
    backup.data.customers.length > 0 ||
    backup.data.invoices.length > 0 ||
    backup.data.payments.length > 0;

  if (!hasAnyData) {
    warnings.push('النسخة الاحتياطية لا تحتوي على أي سجلات بيانات');
  }

  return { ok: true, value: backup, warnings };
}

/** قراءة ملف JSON مع حدود أمان على الحجم. */
export function readBackupFile(file: File, maxBytes = 200 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error('حجم الملف أكبر من الحد المسموح (200 ميجابايت)'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error('الملف ليس بصيغة JSON صالحة'));
      }
    };
    reader.readAsText(file);
  });
}
