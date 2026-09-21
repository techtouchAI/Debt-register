import { db, logActivity, createNotification, checkLowStock, getSettingsOrDefault } from './db';
import { roundMoney, toFiniteNumber } from './utils';
import type { Material } from '@/types';

/**
 * عمليات المواد الموحّدة.
 *
 * الهدف: إدخال المواد يتم من مكانين (صفحة المخزن + الإضافة السريعة داخل
 * فاتورة البيع)، والتحقق والحفظ كانا مكررين — أي إصلاح في أحدهما لا يصل
 * للآخر. هذه الوحدة هي المصدر الوحيد للحقيقة لكلا المسارين.
 */

export interface MaterialInput {
  name: string;
  quantity: number;
  salePrice: number;
  purchasePrice?: number;
  minQuantity: number;
  category: string;
  unit: string;
  barcode?: string;
  description?: string;
}

export type MaterialSaveResult =
  | { ok: true; material: Material; id: number }
  | { ok: false; error: string };

export function validateMaterialInput(input: Partial<MaterialInput>): { ok: true; value: MaterialInput } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'اسم المادة مطلوب' };
  if (name.length > 120) return { ok: false, error: 'اسم المادة طويل جداً (120 حرفاً كحد أقصى)' };

  const salePrice = toFiniteNumber(input.salePrice, NaN);
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    return { ok: false, error: 'سعر البيع مطلوب ويجب أن يكون رقماً موجباً' };
  }

  const quantity = toFiniteNumber(input.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, error: 'الكمية يجب أن تكون رقماً موجباً' };
  }

  let purchasePrice: number | undefined;
  if (input.purchasePrice !== undefined && input.purchasePrice !== null && String(input.purchasePrice).trim() !== '') {
    const parsed = toFiniteNumber(input.purchasePrice, NaN);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: 'سعر الشراء يجب أن يكون رقماً موجباً' };
    }
    purchasePrice = parsed;
  }

  const minQuantity = Math.max(0, toFiniteNumber(input.minQuantity, 0));
  const category = (input.category ?? '').trim() || 'عام';
  const unit = (input.unit ?? '').trim() || 'قطعة';
  const barcode = (input.barcode ?? '').trim() || undefined;
  const description = (input.description ?? '').trim() || undefined;

  return {
    ok: true,
    value: {
      name,
      quantity: roundMoney(quantity),
      salePrice: roundMoney(salePrice),
      purchasePrice: purchasePrice === undefined ? undefined : roundMoney(purchasePrice),
      minQuantity,
      category,
      unit,
      barcode,
      description
    }
  };
}

/** إنشاء مادة جديدة مع سجل النشاط وتنبيه المخزون المنخفض. */
export async function createMaterial(input: Partial<MaterialInput>): Promise<MaterialSaveResult> {
  const validation = validateMaterialInput(input);
  if (!validation.ok) return validation;

  const settings = await getSettingsOrDefault();
  const value = validation.value;
  const duplicate = await findMaterialByName(value.name);
  if (duplicate) return { ok: false, error: `المادة "${duplicate.name}" موجودة مسبقاً` };
  const now = new Date().toISOString();

  // الحد الافتراضي يُطبَّق فقط عند عدم إدخال قيمة — الصفر الصريح يعني "بلا تنبيه"
  const rawMin: unknown = input.minQuantity;
  const minProvided =
    rawMin !== undefined && rawMin !== null && !(typeof rawMin === 'string' && rawMin.trim() === '');
  const record: Material = {
    ...value,
    minQuantity: minProvided ? value.minQuantity : Math.max(0, toFiniteNumber(settings.lowStockThreshold, 5)),
    createdAt: now,
    updatedAt: now
  };

  const id = (await db.materials.add(record)) as number;
  const material: Material = { ...record, id };

  await logActivity('إضافة مادة', `تمت إضافة مادة جديدة: ${material.name}`, 'material', id).catch((error) =>
    console.warn('تعذّر تسجيل النشاط:', error)
  );

  if (material.quantity <= material.minQuantity) {
    await createNotification(
      'تنبيه مخزون',
      `المادة "${material.name}" كميتها منخفضة: ${material.quantity}`,
      { type: 'warning', relatedId: id, relatedType: 'material', code: 'low-stock' }
    ).catch((error) => console.warn('تعذّر إنشاء الإشعار:', error));
  }

  await checkLowStock().catch((error) => console.warn('تعذّر فحص المخزون:', error));
  return { ok: true, material, id };
}

/** تحديث مادة موجودة. */
export async function updateMaterial(id: number, input: Partial<MaterialInput>): Promise<MaterialSaveResult> {
  const existing = await db.materials.get(id);
  if (!existing) return { ok: false, error: 'المادة غير موجودة' };

  // Partial input يعني "حدّث الحقول المرسلة"؛ لا نمسح الحقول الاختيارية
  // القديمة لمجرد أن استدعاءً آخر لم يرسلها.
  const validation = validateMaterialInput({ ...existing, ...input });
  if (!validation.ok) return validation;

  const duplicate = await findMaterialByName(validation.value.name);
  if (duplicate && duplicate.id !== id) return { ok: false, error: `المادة "${duplicate.name}" موجودة مسبقاً` };

  const now = new Date().toISOString();
  const record: Material = {
    ...validation.value,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  await db.materials.update(id, record);
  const material: Material = { ...record, id };

  await logActivity('تعديل مادة', `تم تعديل المادة: ${material.name}`, 'material', id).catch((error) =>
    console.warn('تعذّر تسجيل النشاط:', error)
  );
  await checkLowStock().catch((error) => console.warn('تعذّر فحص المخزون:', error));

  return { ok: true, material, id };
}

/** حذف مادة غير مرتبطة بفواتير أو وصول شراء. */
export async function deleteMaterial(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'معرّف المادة غير صالح' };

  const result = await db.transaction('rw', [db.materials, db.invoiceItems, db.purchaseItems], async () => {
    const material = await db.materials.get(id);
    if (!material) return { ok: false as const, error: 'المادة غير موجودة' };

    const [invoiceUses, purchaseUses] = await Promise.all([
      db.invoiceItems.where('materialId').equals(id).count(),
      db.purchaseItems.where('materialId').equals(id).count()
    ]);
    if (invoiceUses > 0 || purchaseUses > 0) {
      return {
        ok: false as const,
        error: `لا يمكن حذف المادة: مرتبطة بـ ${invoiceUses} فاتورة و${purchaseUses} وصل شراء`
      };
    }

    await db.materials.delete(id);
    return { ok: true as const, material };
  });

  if (!result.ok) return result;
  await logActivity('حذف مادة', `تم حذف المادة: ${result.material.name}`, 'material', id).catch((error) =>
    console.warn('تعذّر تسجيل النشاط:', error)
  );
  return { ok: true };
}

/** هل توجد مادة بنفس الاسم؟ (لمنع التكرار عند الإضافة السريعة) */
export async function findMaterialByName(name: string): Promise<Material | undefined> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  const all = await db.materials.toArray();
  return all.find((material) => material.name.trim().toLowerCase() === normalized);
}
