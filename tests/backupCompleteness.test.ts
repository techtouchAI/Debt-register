import { describe, expect, it } from 'vitest';
import { db, updateSettings } from '@/lib/db';
import { BACKUP_FORMAT_VERSION, computeBackupIntegrity, createBackup, restoreBackupData, verifyBackupIntegrity } from '@/lib/backup';
import { normalizeBackup } from '@/lib/validate';
import type { BackupData } from '@/types';

const T1 = '2026-03-10T09:15:00.000Z';
const T2 = '2026-03-11T10:30:00.000Z';

async function seedEverything() {
  await updateSettings({ officeName: 'مكتب الرافدين', phone: '07701234567', address: 'الحلة', theme: 'dark' });
  await db.users.clear();
  await db.users.add({ id: 1, name: 'المدير', role: 'admin', pin: '', createdAt: T1 });
  await db.materials.add({ id: 10, name: 'سماد يوريا', quantity: 8, salePrice: 25000, averageCost: 21000, lastCost: 21000, minQuantity: 5, unit: 'كيس', category: 'أسمدة', createdAt: T1, updatedAt: T2 });
  await db.customers.add({ id: 20, fullName: 'حسن علي', createdAt: T1, updatedAt: T2 });
  await db.invoices.add({ id: 30, invoiceNumber: 'ف-202603-0001', type: 'credit', customerId: 20, customerName: 'حسن علي', itemsCount: 1, subtotal: 50000, discount: 0, total: 50000, paidAmount: 10000, remaining: 40000, date: T1, createdAt: T1, status: 'partial' });
  await db.invoiceItems.add({ id: 31, invoiceId: 30, materialId: 10, materialName: 'سماد يوريا', quantity: 2, unitPrice: 25000, unitCost: 21000, total: 50000 });
  await db.payments.add({ id: 40, customerId: 20, customerName: 'حسن علي', amount: 10000, date: T2, method: 'transfer', receiptNumber: 'ق-2026-00001', createdAt: T2 });
  await db.customerLedger.bulkAdd([
    { customerId: 20, date: T1, type: 'invoice', amount: 50000, referenceId: 30, createdAt: T1 },
    { customerId: 20, date: T2, type: 'payment', amount: -10000, referenceId: 40, createdAt: T2 }
  ]);
  await db.stockMovements.bulkAdd([
    { materialId: 10, date: T1, quantity: 10, cost: 21000, type: 'manual_entry', notes: 'رصيد افتتاحي', createdAt: T1 },
    { materialId: 10, date: T1, quantity: -2, cost: 21000, type: 'sale', referenceId: 30, createdAt: T1 }
  ]);
  await db.meta.bulkPut([{ key: 'seq:ف-202603-', value: 9 }, { key: 'auth:recovery', value: { hash: 'sha256$aa$bb', createdAt: T1 } }]);
}

async function clearBusinessData() {
  await Promise.all([db.materials.clear(), db.customers.clear(), db.invoices.clear(), db.invoiceItems.clear(), db.payments.clear(), db.customerLedger.clear(), db.stockMovements.clear(), db.meta.clear()]);
}

describe('النسخة الاحتياطية الكاملة', () => {
  it('تحمل دفتر الذمم وحركات المخزون وتستعيدهما مع المراجع', async () => {
    await seedEverything();
    const backup = await createBackup();
    expect(backup.version).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.counts).toMatchObject({ customerLedger: 2, stockMovements: 2 });
    expect(backup.data.invoiceItems[0].unitCost).toBe(21000);

    await clearBusinessData();
    const result = await restoreBackupData(backup);
    expect(result.counts).toMatchObject({ customerLedger: 2, stockMovements: 2 });
    expect(await db.customerLedger.count()).toBe(2);
    expect(await db.stockMovements.count()).toBe(2);
    expect((await db.invoiceItems.get(31))?.unitCost).toBe(21000);
  });

  it('يكشف تعديل محتوى النسخة عبر البصمة من دون تشفير الملف', async () => {
    await seedEverything();
    const backup = await createBackup();
    backup.integrity = await computeBackupIntegrity(backup.data);
    const altered = structuredClone(backup) as BackupData;
    altered.data.materials[0].name = 'مادة معدلة';
    const warnings = await verifyBackupIntegrity(altered);
    expect(warnings.join(' ')).toContain('بصمة الملف');
    expect(JSON.stringify(backup)).toContain('سماد يوريا');
  });

  it('يرفض المراجع غير المتسقة في دفتر الذمم بدلاً من إسقاطها بصمت', async () => {
    await seedEverything();
    const backup = await createBackup();
    backup.data.customerLedger![0].amount = 999;
    const normalized = normalizeBackup(backup);
    expect(normalized.ok).toBe(false);
  });

  it('يرفض نسخة حديثة ناقصة قيداً مصدره فاتورة أو تسديد', async () => {
    await seedEverything();
    const backup = await createBackup();
    backup.data.customerLedger = backup.data.customerLedger?.filter((entry) => entry.type !== 'payment');
    const normalized = normalizeBackup(backup);
    expect(normalized.ok).toBe(false);
  });

  it('يحوّل النسخة القديمة بلا دفاتر إلى قيود افتتاحية موثقة', () => {
    const normalized = normalizeBackup({
      version: '1.3.0', date: T1,
      data: {
        settings: [], users: [],
        materials: [{ id: 1, name: 'مادة قديمة', quantity: 3, salePrice: 10, purchasePrice: 5, minQuantity: 1, createdAt: T1, updatedAt: T1 }],
        customers: [{ id: 2, fullName: 'زبون', createdAt: T1, updatedAt: T1 }],
        invoices: [{ id: 3, invoiceNumber: 'INV-1', type: 'credit', customerId: 2, customerName: 'زبون', itemsCount: 0, subtotal: 20, discount: 0, total: 20, paidAmount: 0, remaining: 20, date: T1, createdAt: T1, status: 'unpaid' }],
        invoiceItems: [], payments: [], notifications: [], activityLogs: []
      }
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.data.customerLedger).toHaveLength(1);
    expect(normalized.value.data.stockMovements).toMatchObject([{ materialId: 1, quantity: 3, cost: 5 }]);
  });
});
