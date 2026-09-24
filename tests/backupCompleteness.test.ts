import { describe, expect, it } from 'vitest';
import { db, updateSettings } from '@/lib/db';
import {
  BACKUP_FORMAT_VERSION,
  computeBackupIntegrity,
  createBackup,
  restoreBackupData,
  saveSnapshot,
  verifyBackupIntegrity
} from '@/lib/backup';
import { normalizeBackup } from '@/lib/validate';
import { nextInvoiceNumber } from '@/lib/sequence';
import { getTheme, setTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/lib/appInfo';
import type { BackupData } from '@/types';

/**
 * النسخة الاحتياطية يجب أن تحمل **كل** تفاصيل المكتب: من اسم المكتب والشعار
 * إلى آخر حقل في كل سجل، وعلامات تسلسل الأرقام. نملأ كل حقل في كل جدول
 * (بما فيها الاختيارية) ثم نستعيد النسخة في قاعدة فارغة ونقارن حقلاً حقلاً.
 */
const T1 = '2026-03-10T09:15:00.000Z';
const T2 = '2026-03-11T10:30:00.000Z';
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function seedEverything() {
  await updateSettings({
    officeName: 'مكتب الرافدين للتجارة الزراعية العامة',
    phone: '07701234567',
    address: 'بغداد - الكرادة - شارع 62',
    logo: LOGO,
    currency: '$',
    lowStockThreshold: 7,
    theme: 'dark',
    autoBackupEnabled: false,
    autoBackupInterval: 120,
    lastBackup: T1,
    language: 'ar',
    invoiceFooter: 'البضاعة المباعة لا ترد ولا تستبدل',
    taxNumber: 'ض-12345'
  });
  await db.users.clear();
  await db.users.bulkAdd([
    { id: 1, name: 'المدير', role: 'admin', pin: 'sha256$aa$bb', createdAt: T1, lastLogin: T2 },
    { id: 2, name: 'أحمد', role: 'sales', pin: 'sha256$cc$dd', createdAt: T2 }
  ]);
  await db.materials.bulkAdd([
    {
      id: 10,
      name: 'سماد يوريا',
      quantity: 42.5,
      salePrice: 25000,
      purchasePrice: 21000,
      category: 'أسمدة',
      barcode: '6281234567890',
      minQuantity: 5,
      unit: 'كيس',
      description: 'كيس 50 كغم',
      createdAt: T1,
      updatedAt: T2
    }
  ]);
  await db.customers.bulkAdd([
    { id: 20, fullName: 'حسن علي كاظم', phone: '07809876543', address: 'الحلة', notes: 'يسدد نهاية الموسم', createdAt: T1, updatedAt: T2 }
  ]);
  await db.invoices.bulkAdd([
    {
      id: 30,
      invoiceNumber: 'ف-202603-0001',
      type: 'credit',
      customerId: 20,
      customerName: 'حسن علي كاظم',
      itemsCount: 1,
      subtotal: 50000,
      discount: 5000,
      total: 45000,
      paidAmount: 10000,
      remaining: 35000,
      date: T1,
      createdAt: T1,
      notes: 'تسليم في المخزن',
      status: 'partial',
      updatedAt: T2,
      downPaymentId: 40
    }
  ]);
  await db.invoiceItems.bulkAdd([
    { id: 31, invoiceId: 30, materialId: 10, materialName: 'سماد يوريا', quantity: 2, unitPrice: 25000, total: 50000, purchasePrice: 21000 }
  ]);
  await db.payments.bulkAdd([
    {
      id: 40,
      customerId: 20,
      customerName: 'حسن علي كاظم',
      amount: 10000,
      date: T1,
      method: 'transfer',
      receiptNumber: 'ق-2026-00001',
      remainingAfter: 35000,
      notes: 'دفعة مقدمة',
      createdAt: T1,
      source: 'downpayment',
      invoiceId: 30
    }
  ]);
  await db.purchases.bulkAdd([
    {
      id: 50,
      purchaseNumber: 'ش-202603-0001',
      supplierName: 'شركة البذور الذهبية',
      itemsCount: 1,
      subtotal: 210000,
      discount: 10000,
      total: 200000,
      date: T1,
      createdAt: T1,
      notes: 'وصل رقم 77 من المورد',
      paymentMethod: 'credit',
      paidAmount: 50000,
      remaining: 150000
    }
  ]);
  await db.purchaseItems.bulkAdd([
    { id: 51, purchaseId: 50, materialId: 10, materialName: 'سماد يوريا', quantity: 10, purchasePrice: 21000, total: 210000 }
  ]);
  await db.notifications.bulkAdd([
    { id: 60, title: 'تنبيه نفاد المخزون', message: 'المادة أوشكت على النفاد', type: 'warning', isRead: true, createdAt: T1, relatedId: 10, relatedType: 'material', code: 'low-stock' }
  ]);
  await db.activityLogs.bulkAdd([
    { id: 70, action: 'إنشاء فاتورة', details: 'فاتورة ف-202603-0001', timestamp: T1, entityType: 'invoice', entityId: 30, userId: 2, userName: 'أحمد' }
  ]);
  await db.meta.bulkPut([
    { key: 'seq:ف-202603-', value: 9 },
    { key: 'auth:recovery', value: { hash: 'sha256$ee$ff', createdAt: T1 } },
    { key: 'office-setup-completed', value: T1 },
    // أعلام صيانة خاصة بالجهاز — لا تنتقل مع النسخة
    { key: 'lastPrune', value: 123 },
    { key: 'allocationFixup', value: 'allocation-v1' }
  ]);
}

/** كل الجداول كما هي في القاعدة (للمقارنة بعد الاستعادة). */
async function snapshotTables() {
  const settings = (await db.settings.toArray()).map(({ id: _id, ...rest }) => rest);
  return {
    settings,
    users: await db.users.toArray(),
    materials: await db.materials.toArray(),
    customers: await db.customers.toArray(),
    invoices: await db.invoices.toArray(),
    invoiceItems: await db.invoiceItems.toArray(),
    payments: await db.payments.toArray(),
    purchases: await db.purchases.toArray(),
    purchaseItems: await db.purchaseItems.toArray(),
    notifications: await db.notifications.toArray(),
    activityLogs: await db.activityLogs.toArray()
  };
}

async function wipeEverything() {
  await Promise.all([
    db.settings.clear(),
    db.users.clear(),
    db.materials.clear(),
    db.customers.clear(),
    db.invoices.clear(),
    db.invoiceItems.clear(),
    db.payments.clear(),
    db.purchases.clear(),
    db.purchaseItems.clear(),
    db.notifications.clear(),
    db.activityLogs.clear(),
    db.meta.clear()
  ]);
}

/** مسار الملف الحقيقي: إنشاء ← JSON نصي ← قراءة ← تحقق ← استعادة. */
async function roundTripThroughFile(): Promise<BackupData> {
  const backup = await createBackup();
  backup.integrity = await computeBackupIntegrity(backup.data);
  const parsed = JSON.parse(JSON.stringify(backup, null, 2)) as BackupData;
  await wipeEverything();
  const normalized = normalizeBackup(parsed);
  if (!normalized.ok) throw new Error(normalized.error);
  await restoreBackupData(normalized.value, normalized.warnings);
  return parsed;
}

describe('النسخة الاحتياطية تحمل كل التفاصيل', () => {
  it('كل حقل في كل جدول يعود كما هو بعد الاستعادة في قاعدة فارغة', async () => {
    await seedEverything();
    const before = await snapshotTables();

    const file = await roundTripThroughFile();
    const after = await snapshotTables();

    expect(after).toEqual(before);
    // بيانات المكتب كاملة: الاسم والشعار والعملة والتذييل والرقم الضريبي والسمة
    expect(after.settings[0]).toMatchObject({
      officeName: 'مكتب الرافدين للتجارة الزراعية العامة',
      logo: LOGO,
      currency: '$',
      invoiceFooter: 'البضاعة المباعة لا ترد ولا تستبدل',
      taxNumber: 'ض-12345',
      theme: 'dark'
    });
    // الحقل الذي كان يُفقد سابقاً: تاريخ آخر تعديل للفاتورة
    expect(after.invoices[0].updatedAt).toBe(T2);
    // نسبة السجل للمستخدم
    expect(after.activityLogs[0]).toMatchObject({ userId: 2, userName: 'أحمد' });

    // بيانات الملف الوصفية
    expect(file.version).toBe(BACKUP_FORMAT_VERSION);
    expect(file.appVersion).toBe(APP_VERSION);
    expect(file.officeName).toBe('مكتب الرافدين للتجارة الزراعية العامة');
    expect(file.counts).toMatchObject({ invoices: 1, users: 2, materials: 1, purchases: 1, meta: 3 });
    expect(file.integrity?.algorithm).toBe('SHA-256');
  });

  it('تنقل علامات التسلسل ورمز الاسترداد ولا تنقل أعلام صيانة الجهاز', async () => {
    await seedEverything();
    const backup = await createBackup();
    const keys = (backup.data.meta ?? []).map((entry) => entry.key).sort();
    expect(keys).toEqual(['auth:recovery', 'office-setup-completed', 'seq:ف-202603-']);

    await roundTripThroughFile();
    expect((await db.meta.get('seq:ف-202603-'))?.value).toBe(9);
    expect((await db.meta.get('auth:recovery'))?.value).toEqual({ hash: 'sha256$ee$ff', createdAt: T1 });
    expect(await db.meta.get('lastPrune')).toBeUndefined();
  });

  it('لا يُعاد استخدام رقم فاتورة محذوفة بعد الاستعادة على جهاز جديد', async () => {
    await seedEverything();
    // علامة التسلسل 9 (فواتير حتى 9 صدرت ثم حُذفت) رغم أن الجدول فيه 0001 فقط
    await roundTripThroughFile();
    expect(await nextInvoiceNumber(new Date(T1))).toBe('ف-202603-0010');
  });

  it('استعادة نسخة أقدم على الجهاز نفسه لا تُرجع أرقاماً صدرت بعدها', async () => {
    await seedEverything();
    const older = await createBackup();
    await db.meta.put({ key: 'seq:ف-202603-', value: 15 }); // صدرت فواتير بعد النسخة
    await restoreBackupData(older);
    expect((await db.meta.get('seq:ف-202603-'))?.value).toBe(15);
  });

  it('تطبّق سمة المكتب المستعادة على الواجهة', async () => {
    setTheme('light');
    await seedEverything();
    const backup = await createBackup();
    setTheme('light');
    await restoreBackupData(backup);
    expect(getTheme()).toBe('dark');
    setTheme('light');
  });
});

describe('سلامة ملف النسخة', () => {
  it('تكشف البصمة الملف المعدّل يدوياً أو التالف جزئياً', async () => {
    await seedEverything();
    const backup = await createBackup();
    backup.integrity = await computeBackupIntegrity(backup.data);
    const intact = JSON.parse(JSON.stringify(backup));
    expect(await verifyBackupIntegrity(intact)).toEqual([]);

    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.data.customers[0].fullName = 'اسم معدّل';
    const warnings = await verifyBackupIntegrity(tampered);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('معدّلاً أو تالفاً');
  });

  it('تُنبّه إن استُعيد عدد سجلات أقل من المعلن في الملف', async () => {
    await seedEverything();
    const backup = JSON.parse(JSON.stringify(await createBackup())) as BackupData;
    // مادة بلا اسم (سجل غير صالح) ⇒ تُتجاهل عند التحقق
    backup.data.materials.push({ ...backup.data.materials[0], id: 11, name: '' });
    backup.counts = { ...backup.counts, materials: 2 };
    const result = await restoreBackupData(backup);
    expect(result.warnings.some((warning) => warning.startsWith('المواد: استُعيد 1 من 2'))).toBe(true);
  });
});

describe('النسخ التلقائية تلتقط كل تعديل', () => {
  it('تعديل فاتورة قديمة (ليست الأخيرة) يُنتج نسخة جديدة', async () => {
    await seedEverything();
    const first = await saveSnapshot('auto');
    expect(first).not.toBeNull();
    // لا تغيير ⇒ لا نسخة مكررة
    expect(await saveSnapshot('auto')).toBeNull();
    // تعديل ملاحظة الفاتورة فقط (لا يتغيّر أي عدد)
    await db.invoices.update(30, { notes: 'ملاحظة جديدة' });
    expect(await saveSnapshot('auto')).not.toBeNull();
    // تغيير شعار المكتب وحده
    await updateSettings({ logo: `${LOGO}#2` });
    expect(await saveSnapshot('auto')).not.toBeNull();
    // تسجيل دخول (آخر دخول) وحده لا يُعد تغييراً في البيانات
    await db.users.update(1, { lastLogin: '2026-09-24T08:00:00.000Z' });
    expect(await saveSnapshot('auto')).toBeNull();
  });
});
