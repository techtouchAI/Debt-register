import { logBackgroundFailure } from './lifecycle';
import { assertPermission } from './session';
import { db, logActivity, createNotification, checkLowStock, getSettingsOrDefault } from './db';
import { recordOpeningStock } from './inventory';
import { roundMoney, toFiniteNumber } from './utils';
import type { Material } from '@/types';

/** بيانات تعريف المادة، والكمية هنا رصيد افتتاحي عند الإنشاء فقط. */
export interface MaterialInput {
  name: string;
  quantity: number;
  salePrice: number;
  /** تكلفة الوحدة المطلوبة إذا كانت هناك كمية افتتاحية. */
  unitCost?: number;
  minQuantity: number;
  category: string;
  unit: string;
  barcode?: string;
  description?: string;
}

export type MaterialSaveResult = { ok: true; material: Material; id: number } | { ok: false; error: string };

export function validateMaterialInput(input: Partial<MaterialInput>): { ok: true; value: MaterialInput } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'اسم المادة مطلوب' };
  if (name.length > 120) return { ok: false, error: 'اسم المادة طويل جداً (120 حرفاً كحد أقصى)' };
  const salePrice = toFiniteNumber(input.salePrice, NaN);
  if (!Number.isFinite(salePrice) || salePrice < 0) return { ok: false, error: 'سعر البيع مطلوب ويجب أن يكون رقماً غير سالب' };
  const quantity = toFiniteNumber(input.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: 'الكمية يجب أن تكون رقماً غير سالب' };

  const rawCost = input.unitCost;
  const hasCost = rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== '';
  const unitCost = hasCost ? toFiniteNumber(rawCost, NaN) : undefined;
  if (hasCost && (!Number.isFinite(unitCost) || (unitCost as number) < 0)) return { ok: false, error: 'تكلفة الوحدة يجب أن تكون رقماً غير سالب' };
  if (quantity > 0 && unitCost === undefined) return { ok: false, error: 'تكلفة الوحدة مطلوبة عند إدخال كمية افتتاحية' };

  return {
    ok: true,
    value: {
      name,
      quantity: roundMoney(quantity),
      salePrice: roundMoney(salePrice),
      unitCost: unitCost === undefined ? undefined : roundMoney(unitCost),
      minQuantity: Math.max(0, roundMoney(toFiniteNumber(input.minQuantity, 0))),
      category: (input.category ?? '').trim() || 'عام',
      unit: (input.unit ?? '').trim() || 'قطعة',
      barcode: (input.barcode ?? '').trim() || undefined,
      description: (input.description ?? '').trim() || undefined
    }
  };
}

/** إنشاء مادة ثم تثبيت رصيدها الافتتاحي كحركة مخزون منفصلة موثقة. */
export async function createMaterial(input: Partial<MaterialInput>): Promise<MaterialSaveResult> {
  assertPermission('materials.manage');
  const validation = validateMaterialInput(input);
  if (!validation.ok) return validation;

  const settings = await getSettingsOrDefault();
  const value = validation.value;
  const minProvided = input.minQuantity !== undefined && input.minQuantity !== null && String(input.minQuantity).trim() !== '';
  const material = await db.transaction('rw', [db.materials, db.stockMovements], async () => {
    // فهرس الاسم لا يضمن تطابق العربية/المسافات، لذا نتحقق داخل المعاملة
    // نفسها لتفادي سباق إنشاء مادتين بالاسم المعروض ذاته.
    const duplicate = (await db.materials.toArray()).find(
      (row) => row.name.trim().toLocaleLowerCase('ar') === value.name.toLocaleLowerCase('ar')
    );
    if (duplicate) throw new Error(`المادة "${duplicate.name}" موجودة مسبقاً`);

    const now = new Date().toISOString();
    const id = (await db.materials.add({
      name: value.name,
      quantity: 0,
      salePrice: value.salePrice,
      averageCost: 0,
      lastCost: value.unitCost,
      minQuantity: minProvided ? value.minQuantity : Math.max(0, toFiniteNumber(settings.lowStockThreshold, 5)),
      category: value.category,
      unit: value.unit,
      barcode: value.barcode,
      description: value.description,
      createdAt: now,
      updatedAt: now
    })) as number;

    // `recordOpeningStock` يدخل المعاملة الحالية في Dexie، فتُحفظ المادة
    // والحركة والرصيد معاً أو تتراجع كلها عند أي فشل.
    if (value.quantity > 0) return recordOpeningStock(id, value.quantity, value.unitCost as number, now);
    return (await db.materials.get(id)) as Material;
  }).catch((error): Material | null => {
    if (error instanceof Error && error.message.startsWith('المادة "')) return null;
    throw error;
  });

  if (!material) {
    const duplicate = await findMaterialByName(value.name);
    return { ok: false, error: `المادة "${duplicate?.name ?? value.name}" موجودة مسبقاً` };
  }
  const id = material.id as number;
  await logActivity('إضافة مادة', `تمت إضافة مادة جديدة: ${material.name}`, 'material', id).catch((error) => logBackgroundFailure('تعذّر تسجيل النشاط:', error));
  if (material.quantity <= material.minQuantity) {
    await createNotification('تنبيه مخزون', `المادة "${material.name}" كميتها منخفضة: ${material.quantity}`, { type: 'warning', relatedId: id, relatedType: 'material', code: 'low-stock' }).catch((error) => logBackgroundFailure('تعذّر إنشاء الإشعار:', error));
  }
  await checkLowStock().catch((error) => logBackgroundFailure('تعذّر فحص المخزون:', error));
  return { ok: true, material, id };
}

/** تعديل تعريف المادة فقط؛ تغير الكمية/التكلفة يجب أن يمر عبر حركة مخزون. */
export async function updateMaterial(id: number, input: Partial<MaterialInput>): Promise<MaterialSaveResult> {
  assertPermission('materials.manage');
  const existing = await db.materials.get(id);
  if (!existing) return { ok: false, error: 'المادة غير موجودة' };
  const requestedQuantity = input.quantity === undefined ? existing.quantity : toFiniteNumber(input.quantity, NaN);
  if (!Number.isFinite(requestedQuantity) || roundMoney(requestedQuantity) !== roundMoney(existing.quantity)) {
    return { ok: false, error: 'لا تعدّل كمية المادة من النموذج؛ سجّل حركة مخزون موثقة' };
  }
  if (input.unitCost !== undefined && input.unitCost !== null && String(input.unitCost).trim() !== '') {
    return { ok: false, error: 'لا تعدّل تكلفة المادة من النموذج؛ سجّل إدخال مخزون بتكلفته' };
  }
  const validation = validateMaterialInput({ ...existing, ...input, quantity: existing.quantity, unitCost: existing.lastCost ?? existing.averageCost });
  if (!validation.ok) return validation;
  const duplicate = await findMaterialByName(validation.value.name);
  if (duplicate && duplicate.id !== id) return { ok: false, error: `المادة "${duplicate.name}" موجودة مسبقاً` };

  const record: Material = {
    ...existing,
    name: validation.value.name,
    salePrice: validation.value.salePrice,
    minQuantity: validation.value.minQuantity,
    category: validation.value.category,
    unit: validation.value.unit,
    barcode: validation.value.barcode,
    description: validation.value.description,
    updatedAt: new Date().toISOString()
  };
  await db.materials.update(id, record);
  const material = { ...record, id };
  await logActivity('تعديل مادة', `تم تعديل بيانات المادة: ${material.name}`, 'material', id).catch((error) => logBackgroundFailure('تعذّر تسجيل النشاط:', error));
  await checkLowStock().catch((error) => logBackgroundFailure('تعذّر فحص المخزون:', error));
  return { ok: true, material, id };
}

/** لا تحذف مادة ذات وثائق بيع أو دفتر مخزون حتى لا ينكسر الأثر التدقيقي. */
export async function deleteMaterial(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  assertPermission('materials.manage');
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'معرّف المادة غير صالح' };
  const result = await db.transaction('rw', [db.materials, db.invoiceItems, db.stockMovements], async () => {
    const material = await db.materials.get(id);
    if (!material) return { ok: false as const, error: 'المادة غير موجودة' };
    const [invoiceUses, movementUses] = await Promise.all([db.invoiceItems.where('materialId').equals(id).count(), db.stockMovements.where('materialId').equals(id).count()]);
    if (invoiceUses || movementUses) return { ok: false as const, error: `لا يمكن حذف المادة: مرتبطة بـ ${invoiceUses} فاتورة و${movementUses} حركة مخزون` };
    await db.materials.delete(id);
    return { ok: true as const, material };
  });
  if (!result.ok) return result;
  await logActivity('حذف مادة', `تم حذف المادة: ${result.material.name}`, 'material', id).catch((error) => logBackgroundFailure('تعذّر تسجيل النشاط:', error));
  return { ok: true };
}

export async function findMaterialByName(name: string): Promise<Material | undefined> {
  const normalized = name.trim().toLocaleLowerCase('ar');
  if (!normalized) return undefined;
  return (await db.materials.toArray()).find((material) => material.name.trim().toLocaleLowerCase('ar') === normalized);
}
