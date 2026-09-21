import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Eye, FileText, Loader2, Package, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { QuickAddPurchaseMaterialDialog } from '@/components/materials/QuickAddPurchaseMaterialDialog';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { db, getSettingsOrDefault } from '@/lib/db';
import { getPurchaseWithItems, savePurchase, computePurchaseTotals, type PurchaseDraft } from '@/lib/purchases';
import { buildPurchasePrintHtml } from '@/lib/print';
import { formatCurrency, formatLocalDateTimeInput, roundMoney, toFiniteNumber, toISOStringOrNull } from '@/lib/utils';
import { reportError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import type { Material, OfficeSettings, Purchase } from '@/types';

interface CartItem {
  material: Material;
  quantity: number;
  purchasePrice: number;
}

export function PurchaseForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const purchaseId = id ? Number(id) : undefined;
  const isEdit = Number.isFinite(purchaseId) && (purchaseId as number) > 0;

  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(formatLocalDateTimeInput());
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('cash');
  const [paidAmount, setPaidAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [searchMaterial, setSearchMaterial] = useState('');
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [loadedPurchase, setLoadedPurchase] = useState<Purchase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [s, allMaterials] = await Promise.all([getSettingsOrDefault(), db.materials.toArray()]);
        if (cancelled) return;
        setSettings(s);
        setMaterials(allMaterials);

        if (isEdit) {
          const found = await getPurchaseWithItems(purchaseId as number);
          if (!found) {
            toast.error('وصل الشراء غير موجود');
            navigate('/purchases', { replace: true });
            return;
          }
          if (cancelled) return;
          setLoadedPurchase(found.purchase);
          setSupplierName(found.purchase.supplierName);
          setDate(formatLocalDateTimeInput(new Date(found.purchase.date)));
          setPaymentMethod(found.purchase.paymentMethod);
          setPaidAmount(toFiniteNumber(found.purchase.paidAmount));
          setDiscount(toFiniteNumber(found.purchase.discount));
          setNotes(found.purchase.notes || '');
          const materialMap = new Map(allMaterials.map((material) => [material.id, material]));
          setCart(
            found.items
              .map((item) => {
                const material = materialMap.get(item.materialId);
                return material ? { material, quantity: item.quantity, purchasePrice: item.purchasePrice } : null;
              })
              .filter((item): item is CartItem => item !== null)
          );
        }
      } catch (error) {
        if (!cancelled) reportError('PurchaseForm.load', error, 'تعذّر تحميل وصل الشراء');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isEdit, navigate, purchaseId]);

  const filteredMaterials = useMemo(() => {
    const query = searchMaterial.trim().toLowerCase();
    if (!query) return [];
    return materials
      .filter((material) =>
        material.name.toLowerCase().includes(query) ||
        (material.category || '').toLowerCase().includes(query) ||
        (material.barcode || '').includes(query)
      )
      .slice(0, 20);
  }, [materials, searchMaterial]);

  const addToCart = (material: Material) => {
    const existing = cart.find((entry) => entry.material.id === material.id);
    if (existing) {
      setCart(cart.map((entry) => entry.material.id === material.id ? { ...entry, quantity: roundMoney(entry.quantity + 1) } : entry));
    } else {
      setCart([...cart, { material, quantity: 1, purchasePrice: toFiniteNumber(material.purchasePrice) }]);
    }
    setSearchMaterial('');
    setShowMaterialList(false);
  };

  const updateQuantity = (materialId: number, value: string) => {
    const quantity = toFiniteNumber(value, NaN);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCart(cart.filter((entry) => entry.material.id !== materialId));
      return;
    }
    setCart(cart.map((entry) => entry.material.id === materialId ? { ...entry, quantity } : entry));
  };

  const updatePurchasePrice = (materialId: number, value: string) => {
    const price = Math.max(0, toFiniteNumber(value));
    setCart(cart.map((entry) => entry.material.id === materialId ? { ...entry, purchasePrice: price } : entry));
  };

  const { subtotal, discount: safeDiscount, total } = computePurchaseTotals(
    cart.map((entry) => ({ materialId: entry.material.id, materialName: entry.material.name, quantity: entry.quantity, purchasePrice: entry.purchasePrice })),
    discount
  );
  const safePaid = paymentMethod === 'cash' ? total : Math.min(total, Math.max(0, roundMoney(toFiniteNumber(paidAmount))));
  const remaining = paymentMethod === 'credit' ? roundMoney(total - safePaid) : 0;

  const openQuickAdd = (name: string) => {
    setQuickAddName(name.trim());
    setShowMaterialList(false);
    setShowQuickAdd(true);
  };

  const handleCreatedMaterial = (material: Material) => {
    setMaterials((current) => current.some((entry) => entry.id === material.id) ? current : [...current, material]);
    addToCart(material);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!supplierName.trim()) {
      toast.warning('اسم المورد مطلوب');
      return;
    }
    if (!cart.length) {
      toast.warning('لا توجد مواد', 'أضف مادة واحدة على الأقل لوصل الشراء');
      return;
    }
    const dateISO = toISOStringOrNull(date);
    if (!dateISO) {
      toast.warning('تاريخ غير صالح', 'اختر تاريخ ووقت الوصل ثم أعد المحاولة');
      return;
    }

    setIsSaving(true);
    try {
      const draft: PurchaseDraft = {
        id: isEdit ? purchaseId : undefined,
        supplierName,
        dateISO,
        discount: safeDiscount,
        paymentMethod,
        paidAmount: safePaid,
        notes,
        items: cart.map((entry) => ({
          materialId: entry.material.id,
          materialName: entry.material.name,
          quantity: entry.quantity,
          purchasePrice: entry.purchasePrice,
          salePrice: entry.material.salePrice,
          category: entry.material.category,
          unit: entry.material.unit
        }))
      };
      const result = await savePurchase(draft);
      if (!result.ok) {
        toast.error('لم يتم حفظ وصل الشراء', result.error);
        return;
      }
      toast.success(isEdit ? 'تم تحديث وصل الشراء' : 'تم حفظ وصل الشراء', `رقم الوصل: ${result.purchaseNumber}`);
      navigate(`/purchases/${result.purchaseId}`);
    } catch (error) {
      reportError('PurchaseForm.save', error, 'حدث خطأ أثناء حفظ وصل الشراء');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!cart.length) {
      toast.warning('لا توجد مواد', 'أضف مادة واحدة على الأقل قبل المعاينة');
      return;
    }
    const previewDate = toISOStringOrNull(date);
    if (!previewDate) {
      toast.warning('تاريخ غير صالح', 'اختر تاريخ ووقت الوصل ثم أعد المعاينة');
      return;
    }
    try {
      const s = settings || await getSettingsOrDefault();
      const previewPurchase: Purchase = {
        purchaseNumber: loadedPurchase?.purchaseNumber || 'مسودة — بدون رقم',
        supplierName: supplierName.trim() || '—',
        itemsCount: cart.length,
        subtotal,
        discount: safeDiscount,
        total,
        date: previewDate,
        createdAt: new Date().toISOString(),
        paymentMethod,
        paidAmount: safePaid,
        remaining,
        notes: notes.trim() || undefined
      };
      setPreviewBody(buildPurchasePrintHtml(
        previewPurchase,
        cart.map((entry) => ({
          purchaseId: 0,
          materialId: entry.material.id as number,
          materialName: entry.material.name,
          quantity: entry.quantity,
          purchasePrice: entry.purchasePrice,
          total: roundMoney(entry.quantity * entry.purchasePrice)
        })),
        s
      ));
    } catch (error) {
      reportError('PurchaseForm.preview', error, 'تعذّر إنشاء المعاينة');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchases')} aria-label="رجوع لوصول الشراء"><ArrowRight className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FileText className="w-7 h-7 text-primary-600" />{isEdit ? 'تعديل وصل شراء' : 'وصل شراء جديد'}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">أدخل المواد مباشرة؛ المادة الجديدة تُسجّل في المخزن تلقائياً عند الحفظ.</p>
          </div>
        </div>
        <Badge variant="secondary">إدخال مخزن</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-base">بيانات وصل الشراء</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">اسم المورد *</label>
                  <Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="اسم الشركة أو المورد" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">تاريخ الوصل</label>
                  <Input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                <button type="button" onClick={() => setPaymentMethod('cash')} className={`py-2.5 rounded-lg text-sm font-medium ${paymentMethod === 'cash' ? 'bg-white dark:bg-gray-700 shadow-sm text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>نقدي</button>
                <button type="button" onClick={() => setPaymentMethod('credit')} className={`py-2.5 rounded-lg text-sm font-medium ${paymentMethod === 'credit' ? 'bg-white dark:bg-gray-700 shadow-sm text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}>آجل للمورد</button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" />مواد الوصل</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={searchMaterial}
                  onChange={(event) => { setSearchMaterial(event.target.value); setShowMaterialList(true); }}
                  onFocus={() => setShowMaterialList(true)}
                  onBlur={() => window.setTimeout(() => setShowMaterialList(false), 150)}
                  className="pr-10 h-12"
                  placeholder="ابحث عن مادة مسجلة أو اكتب اسماً جديداً..."
                />
                {showMaterialList && searchMaterial.trim() && (
                  <div className="absolute z-20 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-80 overflow-y-auto">
                    {filteredMaterials.map((material) => (
                      <button type="button" key={material.id} onClick={() => addToCart(material)} className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b last:border-0 flex items-center justify-between">
                        <div><p className="font-medium text-sm">{material.name}</p><p className="text-xs text-gray-500">{material.category || 'عام'} • الرصيد: {material.quantity} {material.unit || 'قطعة'} • سعر الشراء: {formatCurrency(toFiniteNumber(material.purchasePrice), settings?.currency)}</p></div>
                        <Plus className="w-4 h-4 text-primary-600" />
                      </button>
                    ))}
                    <button type="button" onClick={() => openQuickAdd(searchMaterial)} className="w-full text-right p-3 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 flex items-center gap-2 text-primary-700 dark:text-primary-300 font-medium text-sm">
                      <Plus className="w-4 h-4" />تسجيل "{searchMaterial.trim()}" كمادة جديدة
                    </button>
                  </div>
                )}
              </div>

              {cart.length ? (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-3 grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-600 dark:text-gray-400">
                    <div className="col-span-5">المادة</div><div className="col-span-2 text-center">الكمية</div><div className="col-span-3 text-center">سعر الشراء</div><div className="col-span-2 text-center">المجموع</div>
                  </div>
                  {cart.map((entry) => (
                    <div key={entry.material.id} className="p-3 grid grid-cols-12 gap-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm">
                      <div className="col-span-5 min-w-0"><p className="font-medium truncate">{entry.material.name}</p><p className="text-[11px] text-gray-500">{entry.material.unit || 'قطعة'} • الرصيد الحالي: {entry.material.quantity}</p></div>
                      <div className="col-span-2"><Input type="number" min="0.01" step="0.01" value={entry.quantity} onChange={(event) => updateQuantity(entry.material.id as number, event.target.value)} className="h-8 text-center" /></div>
                      <div className="col-span-3"><Input type="number" min="0" step="0.01" value={entry.purchasePrice} onChange={(event) => updatePurchasePrice(entry.material.id as number, event.target.value)} className="h-8 text-center text-xs" /></div>
                      <div className="col-span-2 flex items-center justify-between gap-1"><span className="font-bold text-green-600 text-xs whitespace-nowrap">{formatCurrency(roundMoney(entry.quantity * entry.purchasePrice), settings?.currency)}</span><Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" aria-label={`حذف ${entry.material.name}`} onClick={() => setCart(cart.filter((item) => item.material.id !== entry.material.id))}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl"><Package className="w-10 h-10 text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-500">لم تتم إضافة مواد</p><p className="text-xs text-gray-400 mt-1">ابحث عن مادة أو سجّل مادة جديدة من هنا</p></div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-md h-fit lg:sticky lg:top-24">
          <CardHeader><CardTitle className="text-base">ملخص الوصل</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">عدد المواد:</span><strong>{cart.length}</strong></div>
              <div className="flex justify-between"><span className="text-gray-500">إجمالي الكمية:</span><strong>{roundMoney(cart.reduce((sum, entry) => sum + entry.quantity, 0))}</strong></div>
              <div className="flex justify-between"><span className="text-gray-500">المجموع:</span><strong>{formatCurrency(subtotal, settings?.currency)}</strong></div>
              <div className="flex items-center justify-between gap-2"><span className="text-gray-500">الخصم:</span><Input type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(toFiniteNumber(event.target.value))} className="w-28 h-8 text-left" dir="ltr" /></div>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <div className="flex justify-between text-base"><strong>الإجمالي:</strong><strong className="text-primary-600">{formatCurrency(total, settings?.currency)}</strong></div>
              {paymentMethod === 'credit' && <><div className="flex items-center justify-between gap-2"><span className="text-gray-500">المدفوع:</span><Input type="number" min="0" max={total} step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(toFiniteNumber(event.target.value))} className="w-28 h-8" /></div><div className="flex justify-between"><span className="text-gray-500">المتبقي:</span><strong className={remaining > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(remaining, settings?.currency)}</strong></div></>}
            </div>
            <div><label className="text-sm font-medium mb-1 block">ملاحظات</label><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full min-h-[70px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" placeholder="ملاحظات اختيارية..." /></div>
            <div className="grid gap-2 pt-2">
              <Button onClick={() => handleSave()} disabled={isSaving || !cart.length} className="h-11 bg-primary-600 hover:bg-primary-700 font-bold">{isSaving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />} {isSaving ? 'جاري الحفظ…' : isEdit ? 'حفظ التعديلات' : 'حفظ وصل الشراء'}</Button>
              <Button variant="outline" onClick={handlePreview} disabled={isSaving || !cart.length}><Eye className="w-4 h-4 ml-1" />معاينة الوصل</Button>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300 leading-relaxed">عند حفظ الوصل تُضاف الكميات للمخزن تلقائياً، وأي مادة جديدة تُحفظ في سجل المواد للاستخدام في الفواتير لاحقاً.</div>
          </CardContent>
        </Card>
      </div>

      <QuickAddPurchaseMaterialDialog open={showQuickAdd} initialName={quickAddName} currency={settings?.currency} defaultMinQuantity={settings?.lowStockThreshold} onClose={() => setShowQuickAdd(false)} onCreated={handleCreatedMaterial} />
      {previewBody && <DocumentPreviewDialog open={previewBody !== null} title={loadedPurchase?.purchaseNumber || 'معاينة وصل الشراء'} bodyHtml={previewBody} fileNameBase={loadedPurchase?.purchaseNumber || `مسودة_شراء_${supplierName || 'وصل'}`} shareTitle="معاينة وصل الشراء" onClose={() => setPreviewBody(null)} />}
    </div>
  );
}
