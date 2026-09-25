import { db, checkLowStock, logActivity } from './db';
import { assertPermission } from './session';
import { logBackgroundFailure } from './lifecycle';
import { roundMoney, toFiniteNumber } from './utils';
import type { InvoiceItem, Material, StockMovement } from '@/types';

export interface ManualStockEntryInput {
  materialId: number;
  quantity: number;
  unitCost?: number;
  date?: string;
  notes?: string;
  /** استخدام داخلي لإنشاء الرصيد الافتتاحي ضمن معاملة إنشاء المادة. */
  suppressAudit?: boolean;
}

function positiveFinite(value: unknown, fallback = NaN): number {
  const parsed = roundMoney(toFiniteNumber(value, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * يسجل إدخالاً أو تسوية يدوية ويراجع الرصيد ومتوسط التكلفة في المعاملة نفسها.
 * لا تسمح هذه الدالة بجعل المخزون سالباً.
 */
export async function recordManualStockMovement(input: ManualStockEntryInput): Promise<Material> {
  assertPermission('materials.manage');
  if (!Number.isInteger(input.materialId) || input.materialId <= 0) throw new Error('المادة غير صالحة');
  const quantity = positiveFinite(input.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error('أدخل كمية غير صفرية');
  const rawDate = typeof input.date === 'string' ? input.date.trim() : undefined;
  if (input.date !== undefined && (!rawDate || !Number.isFinite(new Date(rawDate).getTime()))) {
    throw new Error('تاريخ حركة المخزون غير صالح');
  }
  const date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

  const saved = await db.transaction('rw', [db.materials, db.stockMovements], async () => {
    const material = await db.materials.get(input.materialId);
    if (!material) throw new Error('المادة غير موجودة');
    const oldQuantity = Math.max(0, positiveFinite(material.quantity, 0));
    const oldAverage = Math.max(0, positiveFinite(material.averageCost, 0));
    const nextQuantity = roundMoney(oldQuantity + quantity);
    if (nextQuantity < 0) throw new Error('لا يمكن أن يصبح المخزون سالباً');

    const enteredCost = input.unitCost === undefined ? undefined : positiveFinite(input.unitCost);
    if (quantity > 0 && (!Number.isFinite(enteredCost) || (enteredCost as number) < 0)) {
      throw new Error('تكلفة الوحدة مطلوبة عند إدخال مخزون');
    }

    const movementCost = quantity > 0 ? (enteredCost as number) : oldAverage;
    const averageCost =
      quantity > 0 && nextQuantity > 0
        ? roundMoney((oldQuantity * oldAverage + quantity * movementCost) / nextQuantity)
        : oldAverage;
    const now = new Date().toISOString();
    await db.stockMovements.add({
      materialId: material.id as number,
      date,
      quantity,
      cost: movementCost,
      type: quantity > 0 ? 'manual_entry' : 'adjustment',
      notes: input.notes?.trim() || (quantity > 0 ? 'إدخال مخزون يدوي' : 'تسوية مخزون يدوية'),
      createdAt: now
    } satisfies StockMovement);
    await db.materials.update(material.id as number, {
      quantity: nextQuantity,
      averageCost,
      ...(quantity > 0 ? { lastCost: movementCost } : {}),
      updatedAt: now
    });
    return (await db.materials.get(material.id as number)) as Material;
  });
  if (!input.suppressAudit) {
    void logActivity('حركة مخزون', `${quantity > 0 ? 'إدخال' : 'تسوية نقص'} للمادة ${saved.name}: ${Math.abs(quantity)}`, 'material', saved.id).catch((error) =>
      logBackgroundFailure('تعذّر تسجيل حركة المخزون:', error)
    );
    void checkLowStock().catch((error) => logBackgroundFailure('تعذّر فحص المخزون:', error));
  }
  return saved;
}

/** إدخال الرصيد الافتتاحي عند إنشاء مادة جديدة. */
export async function recordOpeningStock(materialId: number, quantity: number, unitCost: number, date?: string): Promise<Material> {
  return recordManualStockMovement({ materialId, quantity, unitCost, date, notes: 'رصيد افتتاحي للمادة', suppressAudit: true });
}

/**
 * يوثق بنود الفاتورة كمبيعات سالبة. يستدعى داخل معاملة حفظ الفاتورة بعد
 * تطبيق فرق الرصيد على المواد، لذلك لا يغير الكمية مرة ثانية.
 */
export async function replaceInvoiceSaleMovements(
  invoiceId: number,
  items: InvoiceItem[],
  costByMaterial: ReadonlyMap<number, number>,
  date: string
): Promise<void> {
  const prior = await db.stockMovements.where('[type+referenceId]').equals(['sale', invoiceId]).toArray().catch(() => [] as StockMovement[]);
  const priorCost = new Map<number, number>();
  for (const movement of prior) if (!priorCost.has(movement.materialId)) priorCost.set(movement.materialId, movement.cost);
  if (prior.length) await db.stockMovements.bulkDelete(prior.map((movement) => movement.id).filter((id): id is number => typeof id === 'number'));

  const now = new Date().toISOString();
  await db.stockMovements.bulkAdd(
    items.map((item) => ({
      materialId: item.materialId,
      date,
      quantity: -Math.abs(roundMoney(toFiniteNumber(item.quantity))),
      cost: Math.max(0, positiveFinite(priorCost.get(item.materialId) ?? costByMaterial.get(item.materialId), 0)),
      type: 'sale' as const,
      referenceId: invoiceId,
      notes: `بيع ضمن الفاتورة ${invoiceId}`,
      createdAt: now
    }))
  );
}
