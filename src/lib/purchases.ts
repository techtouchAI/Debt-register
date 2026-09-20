import { db, checkLowStock, getSettingsOrDefault, logActivity } from './db';
import { nextPurchaseNumber } from './sequence';
import { formatCurrency, roundMoney, toFiniteNumber } from './utils';
import type { Material, Purchase, PurchaseItem } from '@/types';

/**
 * بنية مادة في وصل الشراء.
 * materialId اختياري عمداً: يمكن إنشاء مادة جديدة من نفس الوصل، ثم تُسجّل
 * في المخزن وتُضاف كميتها إلى الرصيد في المعاملة نفسها.
 */
export interface PurchaseDraftItem {
  materialId?: number;
  materialName: string;
  quantity: number;
  purchasePrice: number;
  salePrice?: number;
  category?: string;
  unit?: string;
}

export interface PurchaseDraft {
  id?: number;
  supplierName: string;
  dateISO: string;
  discount: number;
  paymentMethod: 'cash' | 'credit';
  paidAmount: number;
  notes?: string;
  items: PurchaseDraftItem[];
}

export type PurchaseSaveResult =
  | { ok: true; purchaseId: number; purchaseNumber: string; purchase: Purchase; items: PurchaseItem[] }
  | { ok: false; error: string };

export interface PurchaseWithItems {
  purchase: Purchase;
  items: PurchaseItem[];
}

export function validatePurchaseDraft(draft: PurchaseDraft): { ok: true } | { ok: false; error: string } {
  const supplierName = (draft.supplierName ?? '').trim();
  if (!supplierName) return { ok: false, error: 'يرجى إدخال اسم المورد' };
  if (!Array.isArray(draft.items) || draft.items.length === 0) return { ok: false, error: 'يرجى إضافة مواد لوصل الشراء' };
  if (draft.paymentMethod !== 'cash' && draft.paymentMethod !== 'credit') {
    return { ok: false, error: 'طريقة الدفع غير صالحة' };
  }
  if (!Number.isFinite(new Date(draft.dateISO).getTime())) return { ok: false, error: 'تاريخ الوصل غير صالح' };
  if (!Number.isFinite(toFiniteNumber(draft.discount, NaN)) || toFiniteNumber(draft.discount) < 0) {
    return { ok: false, error: 'قيمة الخصم غير صالحة' };
  }

  for (const item of draft.items) {
    const name = (item.materialName ?? '').trim();
    if (!name) return { ok: false, error: 'اسم المادة مطلوب لكل بند' };
    const qty = toFiniteNumber(item.quantity, NaN);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: `كمية غير صالحة للمادة "${name}"` };
    const price = toFiniteNumber(item.purchasePrice, NaN);
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: `سعر شراء غير صالح للمادة "${name}"` };
    if (item.salePrice !== undefined && item.salePrice !== null && String(item.salePrice).trim() !== '') {
      const salePrice = toFiniteNumber(item.salePrice, NaN);
      if (!Number.isFinite(salePrice) || salePrice < 0) return { ok: false, error: `سعر البيع غير صالح للمادة "${name}"` };
    }
  }
  return { ok: true };
}

export function computePurchaseTotals(items: PurchaseDraftItem[], discount: number) {
  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + roundMoney(toFiniteNumber(item.quantity) * toFiniteNumber(item.purchasePrice)), 0)
  );
  const safeDiscount = Math.min(Math.max(roundMoney(toFiniteNumber(discount)), 0), subtotal);
  const total = roundMoney(subtotal - safeDiscount);
  return { subtotal, discount: safeDiscount, total };
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * إيجاد المادة أو إنشاء سجل أولي داخل معاملة الشراء.
 * لا نستدعي createMaterial هنا لأن تلك العملية تسجّل إشعارات وآثاراً جانبية
 * خارج معاملة الشراء، وقد تجعل معاملة Dexie غير نشطة أثناء الإنشاء.
 */
async function resolveMaterialInTransaction(item: PurchaseDraftItem, now: string, defaultMinQuantity: number): Promise<Material> {
  if (typeof item.materialId === 'number') {
    const existing = await db.materials.get(item.materialId);
    if (existing) return existing;
  }

  const wanted = normalizedName(item.materialName);
  const existing = (await db.materials.toArray()).find((material) => normalizedName(material.name) === wanted);
  if (existing) return existing;

  const purchasePrice = roundMoney(toFiniteNumber(item.purchasePrice));
  const enteredSalePrice = toFiniteNumber(item.salePrice, NaN);
  const record: Material = {
    name: item.materialName.trim(),
    quantity: 0,
    salePrice: Number.isFinite(enteredSalePrice) ? roundMoney(enteredSalePrice) : roundMoney(purchasePrice * 1.3),
    purchasePrice,
    minQuantity: defaultMinQuantity,
    category: item.category?.trim() || 'عام',
    unit: item.unit?.trim() || 'قطعة',
    createdAt: now,
    updatedAt: now
  };
  const id = (await db.materials.add(record)) as number;
  return { ...record, id };
}

export async function savePurchase(draft: PurchaseDraft): Promise<PurchaseSaveResult> {
  const validation = validatePurchaseDraft(draft);
  if (!validation.ok) return validation;

  const isEdit = typeof draft.id === 'number';
  const supplierName = draft.supplierName.trim();
  const { subtotal, discount, total } = computePurchaseTotals(draft.items, draft.discount);
  const dateISO = new Date(draft.dateISO).toISOString();

  const result = await db.transaction(
    'rw',
    [db.purchases, db.purchaseItems, db.materials, db.meta, db.settings],
    async (): Promise<PurchaseSaveResult> => {
      const now = new Date().toISOString();
      const officeSettings = await db.settings.toCollection().first();
      const defaultMinQuantity = Math.max(0, toFiniteNumber(officeSettings?.lowStockThreshold, 5));
      const existing = isEdit ? await db.purchases.get(draft.id as number) : undefined;
      if (isEdit && !existing) return { ok: false, error: 'وصل الشراء غير موجود' };

      // التعديل يعكس البنود القديمة أولاً، ثم يطبق البنود الجديدة. نتحقق من
      // كل الكميات قبل أي كتابة حتى لا يترك التعديل مخزوناً نصف محدث عند الفشل.
      const previousItems = isEdit ? await db.purchaseItems.where('purchaseId').equals(draft.id as number).toArray() : [];
      const previousByMaterial = new Map<number, number>();
      for (const previous of previousItems) {
        previousByMaterial.set(previous.materialId, roundMoney((previousByMaterial.get(previous.materialId) ?? 0) + toFiniteNumber(previous.quantity)));
      }
      const previousMaterials = await db.materials.bulkGet(Array.from(previousByMaterial.keys()));
      for (const [materialId, quantity] of previousByMaterial) {
        const material = previousMaterials.find((entry) => entry?.id === materialId);
        if (!material) return { ok: false, error: `المادة المرتبطة بالوصل غير موجودة (رقم ${materialId})` };
        if (toFiniteNumber(material.quantity) + 0.0001 < quantity) {
          return { ok: false, error: `لا يمكن تعديل الوصل: كمية "${material.name}" استُخدمت في مبيعات لاحقة` };
        }
      }
      for (const [materialId, quantity] of previousByMaterial) {
        const material = previousMaterials.find((entry) => entry?.id === materialId);
        if (!material) continue;
        await db.materials.update(materialId, {
          quantity: roundMoney(toFiniteNumber(material.quantity) - quantity),
          updatedAt: now
        });
      }
      if (isEdit) await db.purchaseItems.where('purchaseId').equals(draft.id as number).delete();

      const purchaseNumber = existing?.purchaseNumber || (await nextPurchaseNumber(new Date(dateISO)));
      const safePaid = draft.paymentMethod === 'cash'
        ? total
        : Math.min(total, Math.max(0, roundMoney(toFiniteNumber(draft.paidAmount))));
      const remaining = draft.paymentMethod === 'cash' ? 0 : roundMoney(total - safePaid);

      let purchaseId = draft.id as number;
      const { id: _ignoredId, ...existingFields } = existing ?? {};
      const record: Purchase = {
        ...existingFields,
        purchaseNumber,
        supplierName,
        itemsCount: draft.items.length,
        subtotal,
        discount,
        total,
        date: dateISO,
        createdAt: existing?.createdAt ?? now,
        notes: draft.notes?.trim() || undefined,
        paymentMethod: draft.paymentMethod,
        paidAmount: safePaid,
        remaining
      };

      if (isEdit) await db.purchases.update(purchaseId, record);
      else purchaseId = (await db.purchases.add(record)) as number;

      const savedItems: PurchaseItem[] = [];
      for (const item of draft.items) {
        const material = await resolveMaterialInTransaction(item, now, defaultMinQuantity);
        if (material.id === undefined) throw new Error(`تعذّر تسجيل المادة "${item.materialName}"`);

        const quantity = roundMoney(toFiniteNumber(item.quantity));
        const purchasePrice = roundMoney(toFiniteNumber(item.purchasePrice));
        const enteredSalePrice = toFiniteNumber(item.salePrice, NaN);
        const salePrice = toFiniteNumber(material.salePrice) > 0
          ? toFiniteNumber(material.salePrice)
          : Number.isFinite(enteredSalePrice) && enteredSalePrice > 0
            ? roundMoney(enteredSalePrice)
            : roundMoney(purchasePrice * 1.3);
        await db.materials.update(material.id, {
          quantity: roundMoney(toFiniteNumber(material.quantity) + quantity),
          purchasePrice,
          salePrice,
          updatedAt: now
        });

        const line: PurchaseItem = {
          purchaseId,
          materialId: material.id,
          materialName: material.name,
          quantity,
          purchasePrice,
          total: roundMoney(quantity * purchasePrice)
        };
        line.id = (await db.purchaseItems.add(line)) as number;
        savedItems.push(line);
      }

      const saved = await db.purchases.get(purchaseId);
      if (!saved) return { ok: false, error: 'تعذّر قراءة وصل الشراء بعد الحفظ' };
      return { ok: true, purchaseId, purchaseNumber, purchase: saved, items: savedItems };
    }
  );

  if (result.ok) {
    const settings = await getSettingsOrDefault();
    await logActivity(
      isEdit ? 'تعديل وصل شراء' : 'إنشاء وصل شراء',
      `تم ${isEdit ? 'تعديل' : 'إنشاء'} وصل شراء ${result.purchaseNumber} من ${supplierName} بمبلغ ${formatCurrency(total, settings.currency)}`,
      'purchase',
      result.purchaseId
    ).catch((error) => console.warn('تعذّر تسجيل النشاط:', error));
    await checkLowStock().catch((error) => console.warn('تعذّر فحص المخزون:', error));
  }

  return result;
}

export async function getPurchaseWithItems(purchaseId: number): Promise<PurchaseWithItems | null> {
  const purchase = await db.purchases.get(purchaseId);
  if (!purchase) return null;
  const items = await db.purchaseItems.where('purchaseId').equals(purchaseId).toArray();
  return { purchase, items };
}

export async function deletePurchase(purchaseId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await db.transaction('rw', [db.purchases, db.purchaseItems, db.materials], async () => {
    const purchase = await db.purchases.get(purchaseId);
    if (!purchase) return { ok: false as const, error: 'وصل الشراء غير موجود' };

    const items = await db.purchaseItems.where('purchaseId').equals(purchaseId).toArray();
    const quantitiesByMaterial = new Map<number, number>();
    for (const item of items) {
      quantitiesByMaterial.set(item.materialId, roundMoney((quantitiesByMaterial.get(item.materialId) ?? 0) + toFiniteNumber(item.quantity)));
    }
    const materials = await db.materials.bulkGet(Array.from(quantitiesByMaterial.keys()));
    for (const [materialId, quantity] of quantitiesByMaterial) {
      const material = materials.find((entry) => entry?.id === materialId);
      if (!material) continue;
      if (toFiniteNumber(material.quantity) + 0.0001 < quantity) {
        return { ok: false as const, error: `لا يمكن حذف الوصل: كمية "${material.name}" استُخدمت في مبيعات لاحقة` };
      }
    }

    const now = new Date().toISOString();
    for (const [materialId, quantity] of quantitiesByMaterial) {
      const material = materials.find((entry) => entry?.id === materialId);
      if (!material) continue;
      await db.materials.update(materialId, {
        quantity: roundMoney(toFiniteNumber(material.quantity) - quantity),
        updatedAt: now
      });
    }
    await db.purchaseItems.where('purchaseId').equals(purchaseId).delete();
    await db.purchases.delete(purchaseId);
    return { ok: true as const };
  });

  if (result.ok) {
    await logActivity('حذف وصل شراء', `تم حذف وصل الشراء رقم ${purchaseId}`, 'purchase', purchaseId).catch(() => undefined);
  }
  return result;
}
