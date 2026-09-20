import Dexie, { Table, type Transaction } from 'dexie';
import {
  OfficeSettings,
  User,
  Material,
  Customer,
  Invoice,
  InvoiceItem,
  Payment,
  Notification as AppNotification,
  ActivityLog,
  BackupMeta,
  BackupSnapshot,
  AppMeta
} from '@/types';
import { toFiniteNumber } from './utils';
import { getCapacitor, getElectronAPI } from './platform';

export class AgriOfficeDB extends Dexie {
  settings!: Table<OfficeSettings>;
  users!: Table<User>;
  materials!: Table<Material>;
  customers!: Table<Customer>;
  invoices!: Table<Invoice>;
  invoiceItems!: Table<InvoiceItem>;
  payments!: Table<Payment>;
  notifications!: Table<AppNotification>;
  activityLogs!: Table<ActivityLog>;
  backups!: Table<BackupMeta>;
  snapshots!: Table<BackupSnapshot>;
  meta!: Table<AppMeta, string>;

  constructor() {
    super('AgriOfficeDB');

    // الإصدار 1 (تاريخي): يُترك كما هو حتى تُرقّى قواعد البيانات القائمة لدى المستخدمين بسلاسة.
    this.version(1).stores({
      settings: '++id',
      users: '++id, name, role',
      materials: '++id, name, category, quantity',
      customers: '++id, fullName, phone',
      invoices: '++id, invoiceNumber, customerId, type, date, customerName',
      invoiceItems: '++id, invoiceId, materialId',
      payments: '++id, customerId, date, receiptNumber',
      notifications: '++id, isRead, createdAt, relatedType',
      activityLogs: '++id, timestamp, entityType',
      backups: '++id, date'
    });

    // الإصدار 2: إضافة الفهارس التي تعتمد عليها الاستعلامات فعلياً.
    this.version(2).stores({
      settings: '++id',
      users: '++id, name, role',
      materials: '++id, name, category, quantity',
      customers: '++id, fullName, phone',
      invoices: '++id, invoiceNumber, customerId, type, date, customerName, createdAt',
      invoiceItems: '++id, invoiceId, materialId',
      payments: '++id, customerId, date, receiptNumber, createdAt',
      notifications: '++id, createdAt, relatedType, relatedId',
      activityLogs: '++id, timestamp, entityType',
      backups: '++id, date'
    });

    // الإصدار 3:
    //  1) جدول snapshots: نسخ احتياطية داخلية دورية بدل تنزيل ملف كل ساعة.
    //  2) جدول meta: أعلام تشغيلية (مثل "تمت مصالحة الأرصدة").
    //  3) فهرس notifications.code: منع تكرار تنبيه المادة نفسها بطريقة موثوقة.
    //  4) ترقية البيانات القديمة/المستوردة: استكمال الحقول الإلزامية حتى لا
    //     تختفي السجلات من القوائم المرتّبة (orderBy يتجاهل السجلات بلا مفتاح).
    this.version(3)
      .stores({
        settings: '++id',
        users: '++id, name, role',
        materials: '++id, name, category, quantity',
        customers: '++id, fullName, phone',
        invoices: '++id, invoiceNumber, customerId, type, date, customerName, createdAt, status',
        invoiceItems: '++id, invoiceId, materialId',
        payments: '++id, customerId, date, receiptNumber, createdAt',
        notifications: '++id, createdAt, relatedType, relatedId, code',
        activityLogs: '++id, timestamp, entityType',
        backups: '++id, date',
        snapshots: '++id, date',
        meta: '&key'
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();

        await tx
          .table('invoices')
          .toCollection()
          .modify((invoice: Invoice) => {
            const date = typeof invoice.date === 'string' && invoice.date ? invoice.date : now;
            invoice.date = date;
            if (!invoice.createdAt) invoice.createdAt = date;
            invoice.total = toFiniteNumber(invoice.total);
            invoice.subtotal = toFiniteNumber(invoice.subtotal, invoice.total);
            invoice.discount = toFiniteNumber(invoice.discount);
            invoice.paidAmount = toFiniteNumber(invoice.paidAmount);
            invoice.remaining = toFiniteNumber(invoice.remaining, Math.max(0, invoice.total - invoice.paidAmount));
            invoice.itemsCount = toFiniteNumber(invoice.itemsCount);
            if (invoice.type !== 'cash') invoice.type = 'credit';
            if (!['paid', 'partial', 'unpaid'].includes(invoice.status)) {
              invoice.status =
                invoice.remaining <= 0 ? 'paid' : invoice.paidAmount > 0 ? 'partial' : 'unpaid';
            }
          });

        await tx
          .table('payments')
          .toCollection()
          .modify((payment: Payment) => {
            const date = typeof payment.date === 'string' && payment.date ? payment.date : now;
            payment.date = date;
            if (!payment.createdAt) payment.createdAt = date;
            payment.amount = toFiniteNumber(payment.amount);
            if (typeof payment.receiptNumber !== 'string' || !payment.receiptNumber) {
              payment.receiptNumber = `REC-${String(payment.id ?? Date.now())}`;
            }
          });

        await tx
          .table('materials')
          .toCollection()
          .modify((material: Material) => {
            if (!material.createdAt) material.createdAt = now;
            if (!material.updatedAt) material.updatedAt = material.createdAt;
            material.quantity = toFiniteNumber(material.quantity);
            material.salePrice = toFiniteNumber(material.salePrice);
            material.minQuantity = toFiniteNumber(material.minQuantity, 0);
            if (!material.name) material.name = 'مادة بدون اسم';
          });

        await tx
          .table('customers')
          .toCollection()
          .modify((customer: Customer) => {
            if (!customer.createdAt) customer.createdAt = now;
            if (!customer.updatedAt) customer.updatedAt = customer.createdAt;
          });

        await tx
          .table('notifications')
          .toCollection()
          .modify((notification: AppNotification) => {
            if (typeof notification.isRead !== 'boolean') notification.isRead = false;
            if (!notification.createdAt) notification.createdAt = now;
          });

        await tx
          .table('invoiceItems')
          .toCollection()
          .modify((item: InvoiceItem) => {
            item.quantity = toFiniteNumber(item.quantity);
            item.unitPrice = toFiniteNumber(item.unitPrice);
            item.total = toFiniteNumber(item.total, item.quantity * item.unitPrice);
          });
      });
  }
}

export const db = new AgriOfficeDB();

export const DEFAULT_SETTINGS: OfficeSettings = {
  officeName: 'المكتب الزراعي',
  phone: '',
  address: '',
  currency: 'د.ع',
  lowStockThreshold: 5,
  theme: 'light',
  autoBackupEnabled: true,
  autoBackupInterval: 60,
  language: 'ar',
  invoiceFooter: 'شكراً لتعاملكم معنا'
};

/* ------------------------------------------------------------------ *
 * التحقق من صلاحية التخزين
 * ------------------------------------------------------------------ */

export interface StorageStatus {
  ok: boolean;
  error?: string;
}

/**
 * اختبار فعلي لقابلية IndexedDB للقراءة والكتابة.
 * بعض المتصفحات (وضع التصفح الخاص، تعطيل التخزين، فتح الملف من مسار محظور)
 * تُبقي الكائن موجوداً لكنها ترفض الكتابة، وبدون هذا الفحص يتجمّد التطبيق
 * على واجهة فارغة بلا رسالة.
 */
export async function checkStorageAvailable(): Promise<StorageStatus> {
  if (typeof indexedDB === 'undefined') {
    return { ok: false, error: 'المتصفح لا يدعم التخزين المحلي (IndexedDB)' };
  }
  try {
    await db.open();
    const probeKey = '__storage_probe__';
    await db.meta.put({ key: probeKey, value: Date.now() });
    await db.meta.delete(probeKey);
    return { ok: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message =
      name === 'QuotaExceededError'
        ? 'مساحة التخزين ممتلئة أو محظورة في هذا المتصفح'
        : error instanceof Error
          ? error.message
          : 'تعذّر فتح قاعدة البيانات';
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------------ *
 * meta
 * ------------------------------------------------------------------ */

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/* ------------------------------------------------------------------ *
 * التهيئة والإعدادات
 * ------------------------------------------------------------------ */

export async function initializeDB() {
  const settingsCount = await db.settings.count();
  if (settingsCount === 0) {
    await db.settings.add({ ...DEFAULT_SETTINGS });
  } else {
    // استكمال أي إعدادات ناقصة في قواعد البيانات القديمة حتى لا تنكسر الشاشات
    const existing = await db.settings.toCollection().first();
    if (existing) {
      const merged: OfficeSettings = { ...DEFAULT_SETTINGS, ...existing };
      await db.settings.put({ ...merged, id: existing.id });
    }
  }

  const usersCount = await db.users.count();
  if (usersCount === 0) {
    await db.users.add({
      name: 'المدير',
      role: 'admin',
      pin: '1234',
      createdAt: new Date().toISOString()
    });
  }
}

export async function getSettings(): Promise<OfficeSettings | undefined> {
  return await db.settings.toCollection().first();
}

/**
 * إعدادات مضمونة: تُعيد القيم الافتراضية إذا كان الجدول فارغاً
 * (مثلاً بعد استيراد نسخة احتياطية قديمة لا تحتوي إعدادات).
 */
export async function getSettingsOrDefault(): Promise<OfficeSettings> {
  const settings = await getSettings();
  return settings ? { ...DEFAULT_SETTINGS, ...settings } : { ...DEFAULT_SETTINGS };
}

export async function updateSettings(updates: Partial<OfficeSettings>): Promise<void> {
  const settings = await getSettings();
  const { id: _ignoredId, ...changes } = updates;
  if (settings?.id !== undefined) {
    await db.settings.update(settings.id, changes);
    return;
  }
  await db.settings.add({ ...DEFAULT_SETTINGS, ...changes });
}

/* ------------------------------------------------------------------ *
 * سجل النشاط
 * ------------------------------------------------------------------ */

export async function logActivity(
  action: string,
  details: string,
  entityType?: string,
  entityId?: number
): Promise<void> {
  await db.activityLogs.add({
    action,
    details,
    timestamp: new Date().toISOString(),
    entityType,
    entityId
  });
}

/* ------------------------------------------------------------------ *
 * الإشعارات
 * ------------------------------------------------------------------ */

/**
 * عدد الإشعارات غير المقروءة.
 * لا يمكن استخدام where('isRead') لأن IndexedDB لا يفهرس القيم المنطقية،
 * لذا نصفّي برمجياً (جدول الإشعارات صغير فلا أثر يُذكر على الأداء).
 */
export function countUnreadNotifications(): Promise<number> {
  return db.notifications.filter((n) => !n.isRead).count();
}

/** تحديد جميع الإشعارات كمقروءة. */
export function markAllNotificationsRead(): Promise<number> {
  return db.notifications.filter((n) => !n.isRead).modify({ isRead: true });
}

export interface CreateNotificationOptions {
  type?: AppNotification['type'];
  relatedId?: number;
  relatedType?: AppNotification['relatedType'];
  code?: string;
}

/** عرض إشعار نظام خارج التطبيق إن كان الإذن ممنوحاً مسبقاً (بلا طلب إذن أثناء العمل). */
async function showSystemNotification(title: string, message: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
      new window.Notification(title, { body: message });
      return;
    }

    const electronAPI = getElectronAPI();
    if (electronAPI?.showNotification) {
      await electronAPI.showNotification(title, message);
      return;
    }

    const cap = getCapacitor();
    if (cap?.isNativePlatform?.() && cap.Plugins?.LocalNotifications) {
      await cap.Plugins.LocalNotifications.schedule({
        notifications: [
          {
            title,
            body: message,
            id: Date.now() % 100000,
            schedule: { at: new Date(Date.now() + 100) }
          }
        ]
      });
    }
  } catch (error) {
    console.warn('تعذّر عرض إشعار النظام:', error);
  }
}

export async function createNotification(
  title: string,
  message: string,
  typeOrOptions: AppNotification['type'] | CreateNotificationOptions = 'info',
  relatedId?: number,
  relatedType?: AppNotification['relatedType']
): Promise<number> {
  const options: CreateNotificationOptions =
    typeof typeOrOptions === 'string'
      ? { type: typeOrOptions, relatedId, relatedType }
      : { type: 'info', ...typeOrOptions };

  const id = (await db.notifications.add({
    title,
    message,
    type: options.type ?? 'info',
    isRead: false,
    createdAt: new Date().toISOString(),
    relatedId: options.relatedId,
    relatedType: options.relatedType,
    code: options.code
  })) as number;

  await showSystemNotification(title, message);
  return id;
}

/** هل يوجد تنبيه نشط (غير مقروء) بنفس الرمز والكيان؟ */
export async function hasActiveNotification(code: string, relatedId: number, relatedType: string): Promise<boolean> {
  const existing = await db.notifications
    .where('relatedId')
    .equals(relatedId)
    .filter((n) => n.code === code && n.relatedType === relatedType && !n.isRead)
    .first();
  return Boolean(existing);
}

/** مسح تنبيه سابق عند زوال سببه (مثلاً إعادة تعبئة المادة). */
export async function clearResolvedNotifications(code: string, relatedId: number): Promise<void> {
  await db.notifications
    .where('relatedId')
    .equals(relatedId)
    .filter((n) => n.code === code && !n.isRead)
    .modify({ isRead: true });
}

export async function checkLowStock(transaction?: Transaction): Promise<Material[]> {
  const settings = await getSettingsOrDefault();
  const threshold = toFiniteNumber(settings.lowStockThreshold, 5);
  const scope = transaction ? transaction.table('materials') : db.materials;
  const lowStockMaterials = (await scope.where('quantity').belowOrEqual(threshold).toArray()) as Material[];

  for (const material of lowStockMaterials) {
    if (material.id === undefined) continue;
    if (await hasActiveNotification('low-stock', material.id, 'material')) continue;

    await createNotification(
      'تنبيه نفاد المخزون',
      `المادة "${material.name}" أوشكت على النفاد. الكمية المتبقية: ${material.quantity}`,
      { type: 'warning', relatedId: material.id, relatedType: 'material', code: 'low-stock' }
    );
  }

  return lowStockMaterials;
}
