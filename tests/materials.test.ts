import { describe, expect, it } from 'vitest';
import { db, checkLowStock } from '@/lib/db';
import { createMaterial, deleteMaterial, findMaterialByName, updateMaterial, validateMaterialInput } from '@/lib/materials';
import { recordManualStockMovement } from '@/lib/inventory';

describe('التحقق من مدخلات المواد', () => {
  it('يرفض الاسم الفارغ والسعر السالب والرصيد الافتتاحي بلا تكلفة', () => {
    expect(validateMaterialInput({ name: '  ', salePrice: 100 }).ok).toBe(false);
    expect(validateMaterialInput({ name: 'مادة', quantity: 1, salePrice: -5, unitCost: 1 }).ok).toBe(false);
    expect(validateMaterialInput({ name: 'مادة', quantity: 1, salePrice: 10 }).ok).toBe(false);
  });

  it('يقبل مادة برصيد افتتاحي وتكلفة وبيانات افتراضية', () => {
    const result = validateMaterialInput({ name: '  سماد يوريا ', quantity: 10, salePrice: 2000, unitCost: 1500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ name: 'سماد يوريا', category: 'عام', unit: 'قطعة', unitCost: 1500 });
  });
});

describe('المادة وحركات المخزون', () => {
  it('ينشئ الرصيد الافتتاحي كحركة موثقة ويحسب التكلفة', async () => {
    const result = await createMaterial({ name: 'مبيد عناكب', quantity: 2, unitCost: 3000, salePrice: 5000, minQuantity: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.material).toMatchObject({ quantity: 2, averageCost: 3000, lastCost: 3000 });
    const movements = await db.stockMovements.where('materialId').equals(result.id).toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'manual_entry', quantity: 2, cost: 3000 });
    expect((await db.notifications.where('code').equals('low-stock').count())).toBeGreaterThan(0);
  });

  it('يدخل مخزوناً بمتوسط تكلفة مرجح ويسجل تسوية نقص بلا تكلفة جديدة', async () => {
    const created = await createMaterial({ name: 'بذور', quantity: 10, unitCost: 100, salePrice: 200 });
    if (!created.ok) throw new Error(created.error);
    const afterEntry = await recordManualStockMovement({ materialId: created.id, quantity: 10, unitCost: 200, notes: 'وارد جديد' });
    expect(afterEntry).toMatchObject({ quantity: 20, averageCost: 150, lastCost: 200 });
    const afterAdjustment = await recordManualStockMovement({ materialId: created.id, quantity: -3 });
    expect(afterAdjustment).toMatchObject({ quantity: 17, averageCost: 150, lastCost: 200 });
  });

  it('يثبّت تاريخ الحركة ويرفض التاريخ غير الصالح', async () => {
    const created = await createMaterial({ name: 'مادة مؤرخة', quantity: 0, salePrice: 100 });
    if (!created.ok) throw new Error(created.error);
    await recordManualStockMovement({
      materialId: created.id,
      quantity: 4,
      unitCost: 25,
      date: '2026-09-20T08:30:00.000Z',
      notes: 'إدخال مؤرخ'
    });
    expect((await db.stockMovements.where('materialId').equals(created.id).first())?.date).toBe('2026-09-20T08:30:00.000Z');
    await expect(recordManualStockMovement({ materialId: created.id, quantity: 1, unitCost: 25, date: 'ليس تاريخاً' })).rejects.toThrow('تاريخ حركة المخزون');
  });

  it('لا يسمح بتعديل الرصيد أو التكلفة من نموذج تعريف المادة', async () => {
    const created = await createMaterial({ name: 'مادة', quantity: 10, unitCost: 50, salePrice: 100 });
    if (!created.ok) throw new Error(created.error);
    const rejected = await updateMaterial(created.id, { name: 'مادة معدلة', quantity: 20, salePrice: 150 });
    expect(rejected.ok).toBe(false);
    const updated = await updateMaterial(created.id, { name: 'مادة معدلة', quantity: 10, salePrice: 150 });
    expect(updated.ok).toBe(true);
    expect((await db.materials.get(created.id))?.quantity).toBe(10);
  });

  it('يمنع حذف مادة لديها حركة مخزون ويحافظ على كشف التدقيق', async () => {
    const created = await createMaterial({ name: 'محمي', quantity: 1, unitCost: 1, salePrice: 2 });
    if (!created.ok) throw new Error(created.error);
    expect(await deleteMaterial(created.id)).toMatchObject({ ok: false });
  });

  it('يستخدم حد المادة عند فحص المخزون ويمنع تكرار الاسم', async () => {
    const first = await createMaterial({ name: 'سماد اليوريا', quantity: 10, unitCost: 1, salePrice: 2, minQuantity: 12 });
    expect(first.ok).toBe(true);
    expect((await checkLowStock()).map((material) => material.name)).toContain('سماد اليوريا');
    expect((await createMaterial({ name: ' سماد اليوريا ', quantity: 0, salePrice: 2 })).ok).toBe(false);
    expect((await findMaterialByName('سماد اليوريا'))?.id).toBe(first.ok ? first.id : undefined);
  });
});
