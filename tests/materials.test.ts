import { describe, it, expect } from 'vitest';
import { db, checkLowStock } from '@/lib/db';
import { createMaterial, updateMaterial, findMaterialByName, validateMaterialInput } from '@/lib/materials';

describe('التحقق من مدخلات المواد', () => {
  it('يرفض الاسم الفارغ والسعر السالب', () => {
    expect(validateMaterialInput({ name: '  ', salePrice: 100 }).ok).toBe(false);
    expect(validateMaterialInput({ name: 'مادة', salePrice: -5 }).ok).toBe(false);
    expect(validateMaterialInput({ name: 'مادة', quantity: -1, salePrice: 10 }).ok).toBe(false);
  });

  it('يقبل مادة صالحة مع قيم افتراضية', () => {
    const result = validateMaterialInput({ name: '  سماد يوريا ', quantity: 10, salePrice: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('سماد يوريا');
    expect(result.value.category).toBe('عام');
    expect(result.value.unit).toBe('قطعة');
  });
});

describe('إنشاء وتحديث المواد', () => {
  it('يستخدم الحد الخاص بالمادة عند فحص المخزون لا حد المكتب فقط', async () => {
    const now = new Date().toISOString();
    await db.materials.bulkAdd([
      { name: 'حد خاص منخفض', quantity: 10, salePrice: 1, minQuantity: 12, createdAt: now, updatedAt: now },
      { name: 'حد خاص طبيعي', quantity: 10, salePrice: 1, minQuantity: 2, createdAt: now, updatedAt: now }
    ]);
    const low = await checkLowStock();
    expect(low.map((material) => material.name)).toEqual(['حد خاص منخفض']);
    expect((await db.notifications.where('code').equals('low-stock').toArray()).map((n) => n.message)).toHaveLength(1);
  });

  it('ينشئ مادة مع سجل نشاط وتنبيه عند انخفاض الكمية', async () => {
    const result = await createMaterial({ name: 'مبيد عناكب', quantity: 2, salePrice: 5000, minQuantity: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.id).toBeGreaterThan(0);
    const stored = await db.materials.get(result.id);
    expect(stored?.name).toBe('مبيد عناكب');
    expect(stored?.category).toBe('عام');

    // الكمية (2) أقل من الحد (5) ← تنبيه مخزون
    const notifications = await db.notifications.toArray();
    expect(notifications.some((n) => n.code === 'low-stock' && n.relatedId === result.id)).toBe(true);

    const logs = await db.activityLogs.toArray();
    expect(logs.some((l) => l.action === 'إضافة مادة')).toBe(true);
  });

  it('يستخدم حد التنبيه من الإعدادات عند عدم إدخاله', async () => {
    const result = await createMaterial({ name: 'بذور', quantity: 100, salePrice: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.material.minQuantity).toBe(5);
  });

  it('يجد المادة بالاسم دون حساسية لحالة الأحرف والمسافات', async () => {
    const created = await createMaterial({ name: 'سماد اليوريا', quantity: 10, salePrice: 100 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await findMaterialByName('  سماد اليوريا ');
    expect(found?.id).toBe(created.id);
    expect(await findMaterialByName('غير موجودة')).toBeUndefined();
  });

  it('يحدّث مادة موجودة ويرفض غير الموجودة', async () => {
    const created = await createMaterial({ name: 'مادة', quantity: 10, salePrice: 100 });
    if (!created.ok) throw new Error('create failed');

    const updated = await updateMaterial(created.id, { name: 'مادة معدلة', quantity: 20, salePrice: 150 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.material.name).toBe('مادة معدلة');
    expect((await db.materials.get(created.id))?.quantity).toBe(20);

    const missing = await updateMaterial(99999, { name: 'x', quantity: 1, salePrice: 1 });
    expect(missing.ok).toBe(false);
  });
});
