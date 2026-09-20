import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { deletePurchase, savePurchase, validatePurchaseDraft } from '@/lib/purchases';
import { createBackup, restoreBackupData } from '@/lib/backup';

const dateISO = '2026-09-20T09:00:00.000Z';

async function addMaterial() {
  const now = new Date().toISOString();
  return (await db.materials.add({
    name: 'سماد مركب',
    quantity: 10,
    salePrice: 25000,
    purchasePrice: 18000,
    minQuantity: 2,
    unit: 'كيس',
    category: 'أسمدة',
    createdAt: now,
    updatedAt: now
  })) as number;
}

describe('وصول الشراء وإدخال المواد', () => {
  it('يسجل مادة جديدة من الوصل ويضيفها للمخزن تلقائياً', async () => {
    const result = await savePurchase({
      supplierName: 'شركة زراعية',
      dateISO,
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 0,
      items: [{ materialName: 'مبيد جديد', quantity: 4, purchasePrice: 12000, salePrice: 16000, unit: 'علبة' }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.purchaseNumber).toMatch(/^PUR-202609-/);
    expect(result.purchase.total).toBe(48000);
    const material = await db.materials.where('name').equals('مبيد جديد').first();
    expect(material?.quantity).toBe(4);
    expect(material?.salePrice).toBe(16000);
    expect(await db.purchaseItems.count()).toBe(1);
  });

  it('يضيف الكمية لمادة مسجلة ويحسب الخصم والدفع الآجل', async () => {
    const materialId = await addMaterial();
    const result = await savePurchase({
      supplierName: 'مورد الجملة',
      dateISO,
      discount: 5000,
      paymentMethod: 'credit',
      paidAmount: 10000,
      items: [{ materialId, materialName: 'سماد مركب', quantity: 5, purchasePrice: 18000 }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.purchase.subtotal).toBe(90000);
    expect(result.purchase.total).toBe(85000);
    expect(result.purchase.paidAmount).toBe(10000);
    expect(result.purchase.remaining).toBe(75000);
    expect((await db.materials.get(materialId))?.quantity).toBe(15);
  });

  it('يعدل الوصل دون مضاعفة كمية المخزن', async () => {
    const materialId = await addMaterial();
    const created = await savePurchase({
      supplierName: 'مورد', dateISO, discount: 0, paymentMethod: 'cash', paidAmount: 0,
      items: [{ materialId, materialName: 'سماد مركب', quantity: 5, purchasePrice: 18000 }]
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await savePurchase({
      id: created.purchaseId, supplierName: 'مورد', dateISO, discount: 0, paymentMethod: 'cash', paidAmount: 0,
      items: [{ materialId, materialName: 'سماد مركب', quantity: 2, purchasePrice: 19000 }]
    });
    expect(updated.ok).toBe(true);
    expect((await db.materials.get(materialId))?.quantity).toBe(12);
    const purchaseItems = await db.purchaseItems.where('purchaseId').equals(created.purchaseId).toArray();
    expect(purchaseItems).toHaveLength(1);
  });

  it('يرفض البيانات غير الصالحة دون كتابة', async () => {
    expect(validatePurchaseDraft({ supplierName: '', dateISO, discount: 0, paymentMethod: 'cash', paidAmount: 0, items: [] }).ok).toBe(false);
    const result = await savePurchase({
      supplierName: 'مورد', dateISO, discount: 0, paymentMethod: 'cash', paidAmount: 0,
      items: [{ materialName: 'مادة', quantity: 0, purchasePrice: 10 }]
    });
    expect(result.ok).toBe(false);
    expect(await db.purchases.count()).toBe(0);
  });

  it('يحذف الوصل ويرجع الكمية للمخزن ويضمّنه في النسخ الاحتياطية', async () => {
    const materialId = await addMaterial();
    const created = await savePurchase({
      supplierName: 'مورد', dateISO, discount: 0, paymentMethod: 'cash', paidAmount: 0,
      items: [{ materialId, materialName: 'سماد مركب', quantity: 3, purchasePrice: 18000 }]
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const backup = await createBackup();
    expect(backup.data.purchases).toHaveLength(1);
    expect(backup.data.purchaseItems).toHaveLength(1);

    const deleted = await deletePurchase(created.purchaseId);
    expect(deleted.ok).toBe(true);
    expect((await db.materials.get(materialId))?.quantity).toBe(10);
    expect(await db.purchases.count()).toBe(0);

    await restoreBackupData(backup);
    expect(await db.purchases.count()).toBe(1);
    expect(await db.purchaseItems.count()).toBe(1);
  });
});
