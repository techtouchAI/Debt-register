import { publishSettings } from './settingsStore';
import Dexie, { Table, type Transaction } from 'dexie';
import {
  OfficeSettings,
  User,
  Material,
  Customer,
  Invoice,
  InvoiceItem,
  Payment,
  CustomerLedger,
  StockMovement,
  Notification as AppNotification,
  ActivityLog,
  BackupMeta,
  BackupSnapshot,
  AppMeta
} from '@/types';
import { getStockStatus, toFiniteNumber } from './utils';
import { validateOfficeName } from './officeName';
import { sendSystemNotification as dispatchSystemNotification } from './notify';
import { assertNotShuttingDown, beginShutdown, endShutdown } from './lifecycle';
import { getSessionUser } from './session';
import { formatErrorMessage } from './errors';

export class AgriOfficeDB extends Dexie {
  settings!: Table<OfficeSettings>;
  users!: Table<User>;
  materials!: Table<Material>;
  customers!: Table<Customer>;
  invoices!: Table<Invoice>;
  invoiceItems!: Table<InvoiceItem>;
  payments!: Table<Payment>;
  /** مخزن IndexedDB اسمه customer_ledger (الخاصية بصيغة TypeScript). */
  customerLedger!: Table<CustomerLedger>;
  /** مخزن IndexedDB اسمه stock_movements (الخاصية بصيغة TypeScript). */
  stockMovements!: Table<StockMovement>;
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
              payment.receiptNumber = `ق-${String(payment.id ?? Date.now())}`;
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

    // الإصدار 4: مخازن تاريخية تُبقى في مسار الترقية فقط لقواعد البيانات القائمة.
    this.version(4).stores({
      settings: '++id',
      users: '++id, name, role',
      materials: '++id, name, category, quantity',
      customers: '++id, fullName, phone',
      invoices: '++id, invoiceNumber, customerId, type, date, customerName, createdAt, status',
      invoiceItems: '++id, invoiceId, materialId',
      payments: '++id, customerId, date, receiptNumber, createdAt',
      purchases: '++id, purchaseNumber, supplierName, date, createdAt',
      purchaseItems: '++id, purchaseId, materialId',
      notifications: '++id, createdAt, relatedType, relatedId, code',
      activityLogs: '++id, timestamp, entityType',
      backups: '++id, date',
      snapshots: '++id, date',
      meta: '&key'
    });

    /*
     * الإصدار 5: دفتر الذمم وحركات المخزون هما مصدر الحقيقة الجديد.
     *
     * لا نعيد تشغيل تاريخ السجلات والفواتير عند الترقية، لأن المخزون القديم
     * قد تضمن إدخالات يدوية لا يمكن تمييزها بأمان. لذلك ننشئ حركة افتتاحية
     * واحدة لكل مادة تطابق رصيدها الحالي، ثم تصبح كل حركة لاحقة موثقة.
     */
    this.version(5)
      .stores({
        settings: '++id',
        users: '++id, name, role',
        materials: '++id, name, category, quantity',
        customers: '++id, fullName, phone',
        invoices: '++id, invoiceNumber, customerId, type, date, customerName, createdAt, status',
        invoiceItems: '++id, invoiceId, materialId',
        payments: '++id, customerId, date, receiptNumber, createdAt',
        purchases: '++id, purchaseNumber, supplierName, date, createdAt',
        purchaseItems: '++id, purchaseId, materialId',
        customer_ledger: '++id, customerId, date, type, referenceId, &[type+referenceId]',
        stock_movements: '++id, materialId, date, type, referenceId, [type+referenceId]',
        notifications: '++id, createdAt, relatedType, relatedId, code',
        activityLogs: '++id, timestamp, entityType',
        backups: '++id, date',
        snapshots: '++id, date',
        meta: '&key'
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const materials = tx.table('materials');
        const ledger = tx.table('customer_ledger');
        const movements = tx.table('stock_movements');

        await materials.toCollection().modify((material: Material) => {
          const legacy = material as Material & { purchasePrice?: unknown };
          const legacyCost = Math.max(0, toFiniteNumber(legacy.purchasePrice));
          material.averageCost = Math.max(0, toFiniteNumber(material.averageCost, legacyCost));
          material.lastCost = Math.max(0, toFiniteNumber(material.lastCost, legacyCost));
          // سعر الشراء القديم قيمة mutable ولم يعد جزءاً من نموذج المادة.
          delete legacy.purchasePrice;
        });

        const ledgerCount = await ledger.count();
        if (ledgerCount === 0) {
          await tx.table('invoices').toCollection().each(async (invoice: Invoice) => {
            if (invoice.type !== 'credit' || typeof invoice.customerId !== 'number' || typeof invoice.id !== 'number') return;
            await ledger.add({
              customerId: invoice.customerId,
              date: invoice.date || invoice.createdAt || now,
              type: 'invoice',
              amount: Math.max(0, toFiniteNumber(invoice.total)),
              referenceId: invoice.id,
              notes: `ترحيل فاتورة ${invoice.invoiceNumber}`,
              createdAt: now
            } satisfies CustomerLedger);
          });
          await tx.table('payments').toCollection().each(async (payment: Payment) => {
            if (typeof payment.customerId !== 'number' || typeof payment.id !== 'number') return;
            await ledger.add({
              customerId: payment.customerId,
              date: payment.date || payment.createdAt || now,
              type: 'payment',
              amount: -Math.max(0, toFiniteNumber(payment.amount)),
              referenceId: payment.id,
              notes: `ترحيل تسديد ${payment.receiptNumber}`,
              createdAt: now
            } satisfies CustomerLedger);
          });
        }

        if ((await movements.count()) === 0) {
          await materials.toCollection().each(async (material: Material) => {
            if (typeof material.id !== 'number') return;
            const quantity = toFiniteNumber(material.quantity);
            if (quantity === 0) return;
            await movements.add({
              materialId: material.id,
              date: material.updatedAt || material.createdAt || now,
              quantity,
              cost: Math.max(0, toFiniteNumber(material.averageCost)),
              type: 'manual_entry',
              notes: 'رصيد افتتاحي تم ترحيله إلى دفتر المخزون',
              createdAt: now
            } satisfies StockMovement);
          });
        }
      });

    // الإصدار 6: إلغاء وصول الشراء نهائياً؛ إدخال المخزون يدوي موثق فقط.
    this.version(6).stores({
      settings: '++id',
      users: '++id, name, role',
      materials: '++id, name, category, quantity',
      customers: '++id, fullName, phone',
      invoices: '++id, invoiceNumber, customerId, type, date, customerName, createdAt, status',
      invoiceItems: '++id, invoiceId, materialId',
      payments: '++id, customerId, date, receiptNumber, createdAt',
      customer_ledger: '++id, customerId, date, type, referenceId, &[type+referenceId]',
      stock_movements: '++id, materialId, date, type, referenceId, [type+referenceId]',
      notifications: '++id, createdAt, relatedType, relatedId, code',
      activityLogs: '++id, timestamp, entityType',
      backups: '++id, date',
      snapshots: '++id, date',
      meta: '&key',
      purchases: null,
      purchaseItems: null
    });

    // أسماء المخازن في IndexedDB مطلوبة بصيغة snake_case المتوافقة مع النسخ.
    this.customerLedger = this.table('customer_ledger');
    this.stockMovements = this.table('stock_movements');
  }
}

export const db = new AgriOfficeDB();

/**
 * حارس دورة الحياة على مستوى قاعدة البيانات.
 *
 * وسيط (middleware) في طبقة DBCore يمرّ منه **كل** استعلام (قراءة أو كتابة)
 * على أي جدول. بمجرد رفع علامة الإغلاق (إغلاق نافذة/إعادة تحميل/انتهاء عمر
 * المكوّن في الاختبارات) يُرفض أي استعلام جديد بخطأ إلغاء مقصود، بدل أن يصل
 * إلى قاعدة مغلقة فيُنتج `DatabaseClosedError` غير مفهوم ولا يمكن السيطرة
 * على توقيته.
 */
db.use({
  stack: 'dbcore',
  name: 'lifecycle-shutdown-guard',
  create: (downlevel) => ({
    ...downlevel,
    table: (name: string) => {
      const table = downlevel.table(name);
      // نغلّف كل دوال الجدول (get/query/mutate/count/openCursor...) بفحص واحد
      return new Proxy(table, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            assertNotShuttingDown();
            return (value as (...inner: unknown[]) => unknown).apply(target, args);
          };
        }
      });
    }
  })
});

/**
 * إغلاق قاعدة البيانات بطريقة آمنة: تُرفع علامة الإغلاق أولاً فتمتنع كل
 * العمليات الجديدة، ثم تُغلق القاعدة ولا تبقى عمليات متأخرة تكتب بعد الإغلاق.
 */
export async function closeDatabase(): Promise<void> {
  beginShutdown('database-close');
  db.close();
}

/** إعادة فتح قاعدة البيانات (بدء تشغيل جديد أو إعداد بيئة اختبار). */
export async function openDatabase(): Promise<void> {
  endShutdown();
  await db.open();
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  // فارغ عمداً: اسم المكتب يُدخله المستخدم في شاشة الإعداد الأولى (معالج
  // التشغيل الأول) ولا يُكتب أي اسم تلقائياً — يظهر الاسم في ترويسة كل
  // فاتورة ووصل فيجب أن يكون اسم المكتب الحقيقي.
  officeName: '',
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
    return { ok: false, error: 'هذا الجهاز لا يدعم التخزين المحلي اللازم لحفظ البيانات' };
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
          ? // رسالة المتصفح إنجليزية تقنية: تُعرض عربيةً عبر المهيّئ الموحّد
            formatErrorMessage(error)
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
  // الإعدادات والمستخدم الافتراضي جزء من عملية الإقلاع نفسها؛ وضعهما في
  // معاملة واحدة يمنع أن تبدأ الواجهة بقاعدة نصف مهيأة إذا انقطع التخزين.
  await db.transaction('rw', [db.settings, db.users], async () => {
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

    // لا بد من مدير واحد على الأقل: في التثبيت الجديد، أو بعد استعادة نسخة
    // تالفة لم يبقَ فيها مدير — وإلا تعذّر الوصول إلى الإعدادات والمستخدمين.
    const users = await db.users.toArray();
    if (!users.some((user) => user.role === 'admin')) {
      await db.users.add({
        name: users.some((user) => user.name === 'المدير') ? 'مدير النظام' : 'المدير',
        role: 'admin',
        // PIN اختياري؛ التثبيت الجديد لا يضع رمزاً معروفاً أو حاجزاً إلزامياً.
        pin: '',
        createdAt: new Date().toISOString()
      });
    }
  });

  // نشر الإعدادات بعد الإقلاع: التخطيط والصفحات تعرض القيمة المحفوظة فوراً
  // بدل انتظار استعلام حيّ قد يتأخر إطاراً كاملاً.
  publishSettings(await db.settings.toCollection().first());
}

/**
 * قراءة الإعدادات (وتحديث المخزن المشترك بها).
 * كل قراءة تُنشئ كائناً جديداً، ولا تُنشر إلا إذا تغيّرت القيم فعلاً.
 */
export async function getSettings(): Promise<OfficeSettings | undefined> {
  const settings = await db.settings.toCollection().first();
  publishSettings(settings);
  return settings;
}

/** إعادة قراءة الإعدادات ونشرها (بعد استيراد نسخة أو حذف كل البيانات). */
export async function refreshSettings(): Promise<OfficeSettings | undefined> {
  const settings = await db.settings.toCollection().first();
  publishSettings(settings ?? null);
  return settings ?? undefined;
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
  const changes: Partial<OfficeSettings> = { ...updates };
  // لا نستخدم sanitizeFileName هنا: اسم المكتب قيمة عرض رسمية ويجب أن
  // تُحفظ كاملة، بما فيها المسافات والأحرف العربية داخل الاسم. التنظيف
  // المسموح به هنا هو إزالة الفراغات الخارجية فقط.
  delete changes.id;
  if (Object.prototype.hasOwnProperty.call(changes, 'officeName')) {
    // التحقق من الاسم قبل الكتابة: لا نقبل نصاً غير نصي ولا اسماً أطول من
    // الحد المسموح، ويُطبَّع (فراغ خارجي + أسطر متعددة) دون اقتطاع أي حرف.
    const validation = validateOfficeName(changes.officeName);
    if (!validation.ok) throw new Error(validation.error ?? 'اسم المكتب غير صالح');
    changes.officeName = validation.value;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'phone') && typeof changes.phone !== 'string') {
    throw new Error('رقم الهاتف غير صالح');
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'address') && typeof changes.address !== 'string') {
    throw new Error('عنوان المكتب غير صالح');
  }

  // القراءة والتحديث/الإنشاء في معاملة واحدة تمنع سباق الحفظ بين شاشة
  // الإعدادات ومعالج التشغيل الأول، وهو سبب شائع لظهور اسم ناقص بعد
  // إعادة فتح الصفحة.
  await db.transaction('rw', db.settings, async () => {
    const settings = await db.settings.toCollection().first();
    if (settings?.id !== undefined) {
      await db.settings.update(settings.id, changes);
      return;
    }
    await db.settings.add({ ...DEFAULT_SETTINGS, ...changes });
  });

  // الشاشات تتحدّث فوراً من المخزن المشترك: لا انتظار لاستعلام حيّ ولا نافذة
  // زمنية يظهر فيها اسم قديم بعد الحفظ.
  publishSettings(await db.settings.toCollection().first());
}

/* ------------------------------------------------------------------ *
 * سجل النشاط
 * ------------------------------------------------------------------ */

/**
 * تسجيل نشاط في السجل، منسوباً تلقائياً إلى المستخدم المسجّل حالياً (إن وُجد)
 * — فيعرف المدير من أضاف الفاتورة أو حذف التسديد.
 */
export async function logActivity(
  action: string,
  details: string,
  entityType?: string,
  entityId?: number
): Promise<void> {
  const user = getSessionUser();
  await db.activityLogs.add({
    action,
    details,
    timestamp: new Date().toISOString(),
    entityType,
    entityId,
    ...(user ? { userId: user.id, userName: user.name } : {})
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

/**
 * عرض إشعار نظام خارج التطبيق (شريط أندرويد / ويندوز / المتصفح).
 * يُفوَّض لخدمة الإشعارات الموحّدة التي تستخدم الإضافات الأصلية الرسمية
 * مع قناة إشعارات وأذونات صحيحة — بدل الوصول القديم غير العامل.
 */
async function showSystemNotification(title: string, message: string): Promise<void> {
  await dispatchSystemNotification(title, message);
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
  // لا يمكن استخدام belowOrEqual هنا لأن لكل مادة حدّاً خاصاً بها. كان
  // المسار القديم يستخدم حدّ المكتب فقط، فتختلف الشارة في المخزن عن الجرس.
  const allMaterials = (await scope.toArray()) as Material[];
  const lowStockMaterials = allMaterials.filter((material) => {
    const minQuantity = toFiniteNumber(material.minQuantity, threshold);
    return getStockStatus(toFiniteNumber(material.quantity), minQuantity) !== 'normal';
  });

  // لا ننفذ آثاراً جانبية خارج المعاملة عندما يُستدعى الفحص من داخلها.
  // الاستدعاء الحالي يتم بعد نجاح معاملات الحفظ، لكن هذا الحارس يحمي أي
  // مسار مستقبلي من TransactionInactiveError أو إشعار قبل commit.
  if (transaction) return lowStockMaterials;

  for (const material of lowStockMaterials) {
    if (material.id === undefined) continue;
    if (await hasActiveNotification('low-stock', material.id, 'material')) continue;

    await createNotification(
      'تنبيه نفاد المخزون',
      `المادة "${material.name}" أوشكت على النفاد. الكمية المتبقية: ${material.quantity}`,
      { type: 'warning', relatedId: material.id, relatedType: 'material', code: 'low-stock' }
    );
  }

  // عند إعادة تعبئة مادة يجب أن يختفي التنبيه القديم من عدّاد الجرس،
  // وإلا سيبقى المستخدم يرى إشعاراً نشطاً رغم أن سبب التنبيه زال.
  if (!transaction) {
    const lowIds = new Set(lowStockMaterials.map((material) => material.id).filter((id): id is number => id !== undefined));
    const activeLowStock = await db.notifications
      .where('relatedType')
      .equals('material')
      .filter((notification) => notification.code === 'low-stock' && !notification.isRead)
      .toArray();
    for (const notification of activeLowStock) {
      if (notification.relatedId !== undefined && !lowIds.has(notification.relatedId) && notification.id !== undefined) {
        await db.notifications.update(notification.id, { isRead: true });
      }
    }
  }

  return lowStockMaterials;
}
