import Dexie from 'dexie';
import { describe, it, expect } from 'vitest';
import { db, getSettings, updateSettings } from '@/lib/db';
import { createBackup, restoreBackupData, saveSnapshot, restoreSnapshot, listSnapshots, importBackup, backupFileName } from '@/lib/backup';
import { normalizeBackup, readBackupFile } from '@/lib/validate';
import { saveInvoice } from '@/lib/invoices';

async function seed() {
  const now = new Date().toISOString();
  const materialId = (await db.materials.add({
    name: 'سماد يوريا',
    quantity: 50,
    salePrice: 2000,
    minQuantity: 5,
    unit: 'كيس',
    category: 'أسمدة',
    createdAt: now,
    updatedAt: now
  })) as number;
  const customerId = (await db.customers.add({ fullName: 'زبون النسخ', createdAt: now, updatedAt: now })) as number;

  const invoice = await saveInvoice({
    type: 'credit',
    customerId,
    customerName: 'زبون النسخ',
    dateISO: '2026-04-01T09:00:00.000Z',
    discount: 0,
    paidAmount: 0,
    items: [{ materialId, materialName: 'سماد يوريا', quantity: 5, unitPrice: 2000 }]
  });
  if (!invoice.ok) throw new Error('seed invoice failed');
  return { materialId, customerId, invoiceId: invoice.invoiceId };
}

describe('النسخ الاحتياطي', () => {
  it('يحفظ اسم المكتب كاملاً بعد التحديث وإعادة القراءة', async () => {
    const officeName = 'مكتب الرافدين الزراعي لخدمات المحاصيل والأسمدة';
    await updateSettings({ officeName });
    expect((await getSettings())?.officeName).toBe(officeName);
    const backup = await createBackup();
    expect(backup.officeName).toBe(officeName);
    expect(backup.data.settings[0].officeName).toBe(officeName);
  });

  it('يصدر ويعيد استيراد البيانات كاملة', async () => {
    const seeded = await seed();
    const backup = await createBackup();
    expect(backup.data.invoices).toHaveLength(1);
    expect(backup.data.settings).toHaveLength(1);

    // مسح البيانات ثم الاستعادة
    await db.materials.clear();
    await db.customers.clear();
    await db.invoices.clear();
    await db.invoiceItems.clear();
    expect(await db.invoices.count()).toBe(0);

    const result = await restoreBackupData(backup);
    expect(result.counts.invoices).toBe(1);
    expect(await db.materials.count()).toBe(1);
    expect(await db.customers.count()).toBe(1);
    expect((await db.materials.get(seeded.materialId))?.quantity).toBe(45);
    expect((await db.invoices.get(seeded.invoiceId))?.status).toBe('unpaid');
  });

  it('يرفض ملفاً تالفاً دون المساس بالبيانات الحالية', async () => {
    const seeded = await seed();

    await expect(restoreBackupData({ nonsense: true } as never)).rejects.toThrow();
    await expect(restoreBackupData({ data: 'not-an-object' } as never)).rejects.toThrow();

    expect(await db.invoices.count()).toBe(1);
    expect((await db.materials.get(seeded.materialId))?.quantity).toBe(45);
  });

  it('يستورد ملف JSON عبر واجهة الملفات', async () => {
    await seed();
    const backup = await createBackup();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });

    const result = await importBackup(file);
    expect(result.counts.invoices).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(await db.backups.count()).toBe(1);
  });

  it('يرفض ملفاً تالفاً برسالة عربية بلا مصطلحات إنجليزية', async () => {
    const file = new File(['{ هذا ليس ملفاً صالحاً'], 'broken.json', { type: 'application/json' });
    await expect(importBackup(file)).rejects.toThrow('الملف ليس نسخة احتياطية صالحة أو أنه تالف');
  });

  it('يستكمل الإعدادات إذا لم تحتويها النسخة', async () => {
    await seed();
    const backup = await createBackup();
    backup.data.settings = [];

    const result = await restoreBackupData(backup);
    expect(result.warnings.join(' ')).toContain('إعدادات');
    const settings = await getSettings();
    // الاسم يبقى فارغاً عمداً فيظهر معالج الإعداد — لا اسم تلقائي
    expect(typeof settings?.officeName).toBe('string');
    expect(settings?.currency).toBeTruthy();
  });

  it('يحفظ نسخاً داخلية ويستعيد آخر نسخة', async () => {
    await seed();
    const snapshot = await saveSnapshot('manual');
    expect(snapshot?.id).toBeTruthy();

    await db.invoices.clear();
    expect(await db.invoices.count()).toBe(0);

    const restored = await restoreSnapshot(snapshot!.id as number);
    expect(restored.counts.invoices).toBe(1);
    expect(await db.invoices.count()).toBe(1);
  });

  it('لا يكرر نسخة تلقائية إذا لم تتغير البيانات', async () => {
    await seed();
    const first = await saveSnapshot('auto');
    const second = await saveSnapshot('auto');
    expect(first?.id).toBeTruthy();
    expect(second).toBeNull();
    expect(await listSnapshots()).toHaveLength(1);
  });

  it('يحتفظ بآخر 5 نسخ داخلية فقط', async () => {
    await seed();
    for (let index = 0; index < 7; index += 1) {
      await saveSnapshot('manual');
    }
    const snapshots = await listSnapshots();
    expect(snapshots.length).toBeLessThanOrEqual(5);
  });

  it('ينظّف أسماء الملفات من الأحرف غير الآمنة', () => {
    expect(backupFileName('../../etc/passwd', new Date(2026, 4, 3, 9, 8, 7))).toBe('etc_passwd_نسخة_احتياطية_2026-05-03_09-08-07.json');
    expect(backupFileName('مكتب الرافدين الزراعي', new Date(2026, 4, 3, 9, 8, 7))).toBe(
      'مكتب الرافدين الزراعي_نسخة_احتياطية_2026-05-03_09-08-07.json'
    );
    expect(backupFileName('', new Date(2026, 0, 1, 0, 0, 0))).toBe('المكتب_نسخة_احتياطية_2026-01-01_00-00-00.json');
  });
});

describe('التحقق من بنية النسخة', () => {
  it('يرفض السجلات غير الصالحة بدل إسقاطها بصمت', () => {
    const result = normalizeBackup({
      version: '2.0.0',
      date: '2026-01-01T00:00:00.000Z',
      data: {
        settings: [{ officeName: 'مكتب', currency: 'د.ع', lowStockThreshold: '7' }],
        materials: [{ id: 1, name: 'مادة', quantity: -1, salePrice: '1500', averageCost: '900', minQuantity: '3' }],
        customers: [{ id: 1, fullName: 'زبون' }],
        invoices: [{ id: 1, invoiceNumber: 'ف-1', type: 'credit', customerId: 1, customerName: 'زبون', total: '1000', paidAmount: '0', date: 'ليس تاريخاً' }],
        invoiceItems: [{ invoiceId: 1, materialId: 1, quantity: '2', unitPrice: '500' }],
        payments: []
      }
    });
    expect(result.ok).toBe(false);
  });

  it('يحوّل قيماً سليمة مكتوبة كنصوص مع الحفاظ على المراجع', () => {
    const result = normalizeBackup({
      version: '2.0.0', date: '2026-01-01T00:00:00.000Z',
      data: {
        settings: [{ officeName: 'مكتب', currency: 'د.ع', lowStockThreshold: '7' }],
        materials: [{ id: 1, name: 'مادة', quantity: '12', salePrice: '1500', averageCost: '900', minQuantity: '3' }],
        customers: [{ id: 1, fullName: 'زبون' }],
        invoices: [{ id: 1, invoiceNumber: 'ف-1', type: 'credit', customerId: 1, customerName: 'زبون', itemsCount: 1, subtotal: '1000', discount: 0, total: '1000', paidAmount: 0, remaining: 1000, date: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', status: 'unpaid' }],
        invoiceItems: [{ invoiceId: 1, materialId: 1, quantity: '2', unitPrice: '500', total: '1000' }],
        payments: []
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.materials[0]).toMatchObject({ quantity: 12, averageCost: 900 });
    expect(result.value.data.invoiceItems[0].total).toBe(1000);
  });

  it('يرفض ما لا يحتوي على بيانات', () => {
    expect(normalizeBackup(null).ok).toBe(false);
    expect(normalizeBackup([]).ok).toBe(false);
    expect(normalizeBackup({ data: null }).ok).toBe(false);
  });

  it('يرفض ملفاً أكبر من الحد المسموح', async () => {
    const big = new File([new Uint8Array(10)], 'big.json');
    await expect(readBackupFile(big, 5)).rejects.toThrow(/الحد المسموح/);
  });
});

describe('ترقية قاعدة البيانات (v2 ← v3)', () => {
  it('يستكمل createdAt المفقود حتى لا تختفي الفواتير من القوائم المرتبة', async () => {
    // بناء قاعدة قديمة بالإصدار الثاني ثم فتح النسخة الجديدة لتفعيل الترقية
    await db.close();
    await db.delete();

    const legacy = new Dexie('AgriOfficeDB');
    legacy.version(1).stores({
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
    legacy.version(2).stores({
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
    await legacy.open();
    await legacy.table('invoices').add({
      invoiceNumber: 'INV-OLD-1',
      type: 'credit',
      customerId: 1,
      customerName: 'زبون قديم',
      itemsCount: 1,
      subtotal: '1000',
      discount: 0,
      total: '1000',
      paidAmount: 0,
      date: '2025-01-01T00:00:00.000Z',
      status: 'unpaid'
    });
    await legacy.table('materials').add({ name: 'مادة قديمة', quantity: '12', salePrice: '1500' });
    await legacy.table('notifications').add({ title: 'تنبيه', message: 'رسالة', type: 'warning' });
    await legacy.close();

    // فتح القاعدة بالإصدار الجديد ← تُنفَّذ دالة الترقية
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(3);

    const ordered = await db.invoices.orderBy('createdAt').toArray();
    expect(ordered).toHaveLength(1);
    expect(ordered[0].createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(ordered[0].total).toBe(1000);
    expect(ordered[0].remaining).toBe(1000);

    const material = await db.materials.toCollection().first();
    expect(material?.quantity).toBe(12);
    expect(typeof material?.createdAt).toBe('string');

    const notification = await db.notifications.toCollection().first();
    expect(notification?.isRead).toBe(false);
    expect(typeof notification?.createdAt).toBe('string');

    // الجداول الجديدة موجودة
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});
