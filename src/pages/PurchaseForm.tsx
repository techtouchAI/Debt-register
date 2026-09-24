import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGoBack, useReturnTo } from '@/hooks/useGoBack';
import { ArrowRight, Eye, FileText, HelpCircle, Loader2, Package, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { CartCell } from '@/components/ui/cart-cell';
import { QuickAddPurchaseMaterialDialog } from '@/components/materials/QuickAddPurchaseMaterialDialog';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { SalesVsPurchaseHelpDialog } from '@/components/help/SalesVsPurchaseHelpDialog';
import { db, getSettingsOrDefault } from '@/lib/db';
import { getPurchaseWithItems, savePurchase, computePurchaseTotals, type PurchaseDraft } from '@/lib/purchases';
import { buildPurchasePrintHtml } from '@/lib/print';
import { formatCurrency, formatLocalDateTimeInput, roundMoney, toFiniteNumber, toISOStringOrNull } from '@/lib/utils';
import { reportError } from '@/lib/errors';
import { formatDocumentNumber } from '@/lib/labels';
import { toast } from '@/lib/toast';
import type { Material, OfficeSettings, Purchase } from '@/types';

/**
 * سطر في الوصل. `null` = الحقل فارغ أثناء التحرير: السطر يبقى في مكانه
 * ويظهر خطأ تحته بدل حذفه أو إعادة الصفر إلى الحقل.
 */
interface CartItem {
  material: Material;
  quantity: number | null;
  purchasePrice: number | null;
}

const lineTotal = (entry: CartItem) => roundMoney(toFiniteNumber(entry.quantity) * toFiniteNumber(entry.purchasePrice));

function cartLineError(entry: CartItem): string | null {
  if (entry.quantity === null || entry.quantity <= 0) return 'أدخل كمية أكبر من صفر';
  if (entry.purchasePrice === null || entry.purchasePrice < 0) return 'أدخل سعر الشراء';
  return null;
}

export function PurchaseForm() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const returnTo = useReturnTo();
  const { id } = useParams();
  const purchaseId = id ? Number(id) : undefined;
  const isEdit = Number.isFinite(purchaseId) && (purchaseId as number) > 0;

  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(formatLocalDateTimeInput());
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('cash');
  const [paidAmount, setPaidAmount] = useState<number | null>(0);
  const [discount, setDiscount] = useState<number | null>(0);
  const [notes, setNotes] = useState('');
  const [searchMaterial, setSearchMaterial] = useState('');
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [loadedPurchase, setLoadedPurchase] = useState<Purchase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
              .map((item): CartItem | null => {
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
      setCart(cart.map((entry) => entry.material.id === material.id ? { ...entry, quantity: roundMoney(toFiniteNumber(entry.quantity) + 1) } : entry));
    } else {
      setCart([...cart, { material, quantity: 1, purchasePrice: toFiniteNumber(material.purchasePrice) }]);
    }
    setSearchMaterial('');
    setShowMaterialList(false);
  };

  // تحديث وظيفي بلا رفض لأي قيمة: التحقق يظهر في السطر ويمنع الحفظ فقط
  const updateLine = (materialId: number, patch: Partial<Pick<CartItem, 'quantity' | 'purchasePrice'>>) => {
    setCart((prev) => prev.map((entry) => (entry.material.id === materialId ? { ...entry, ...patch } : entry)));
  };

  const { subtotal, discount: safeDiscount, total } = computePurchaseTotals(
    cart.map((entry) => ({
      materialId: entry.material.id,
      materialName: entry.material.name,
      quantity: toFiniteNumber(entry.quantity),
      purchasePrice: toFiniteNumber(entry.purchasePrice)
    })),
    toFiniteNumber(discount)
  );
  const safePaid = paymentMethod === 'cash' ? total : Math.min(total, Math.max(0, roundMoney(toFiniteNumber(paidAmount))));
  const remaining = paymentMethod === 'credit' ? roundMoney(total - safePaid) : 0;
  const invalidLine = cart.find((entry) => cartLineError(entry) !== null);
  const discountError = discount !== null && roundMoney(discount) > subtotal ? `الخصم أكبر من المجموع (${subtotal})` : null;
  const paidError =
    paymentMethod === 'credit' && paidAmount !== null && roundMoney(paidAmount) > total ? `المدفوع أكبر من الإجمالي (${total})` : null;

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
    if (invalidLine) {
      toast.warning('راجع المواد', `${invalidLine.material.name}: ${cartLineError(invalidLine)}`);
      return;
    }
    if (discountError || paidError) {
      toast.warning('راجع المبالغ', (discountError ?? paidError) as string);
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
          quantity: toFiniteNumber(entry.quantity),
          purchasePrice: toFiniteNumber(entry.purchasePrice),
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
      toast.success(isEdit ? 'تم تحديث وصل الشراء' : 'تم حفظ وصل الشراء', `رقم الوصل: ${formatDocumentNumber(result.purchaseNumber)}`);
      // صفحة الوصل المحفوظ تحلّ محل النموذج (أو نرجع إليها إن جئنا منها)،
      // فلا يعيد زر الرجوع فتح نموذج أُرسل للتو.
      returnTo(`/purchases/${result.purchaseId}`);
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
          quantity: toFiniteNumber(entry.quantity),
          purchasePrice: toFiniteNumber(entry.purchasePrice),
          total: lineTotal(entry)
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
          <Button variant="ghost" size="icon" onClick={() => goBack('/purchases')} aria-label="رجوع لوصول الشراء"><ArrowRight className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FileText className="w-7 h-7 text-primary-600" />{isEdit ? 'تعديل وصل شراء' : 'وصل شراء جديد'}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              شراء من مورد: تدخل المواد إلى المخزن وتُسجَّل مشترياتك نقداً أو ديناً عليه — أما بيع المواد للزبائن فيُسجَّل في فاتورة البيع.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">إدخال مخزن</Badge>
          <Button variant="outline" onClick={() => setShowHelp(true)}>
            <HelpCircle className="w-4 h-4 ml-1" />
            ما الفرق؟
          </Button>
        </div>
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
                  {/* رأس الجدول للشاشات المتوسطة فأعلى؛ على الجوال يحمل كل حقل
                      عنوانه داخل السطر (CartCell) فيبقى العرض كافياً للأرقام. */}
                  <div className="hidden bg-gray-50 dark:bg-gray-800/50 p-3 text-[11px] font-bold text-gray-600 dark:text-gray-400 sm:grid sm:grid-cols-12 sm:gap-2">
                    <div className="col-span-5">المادة</div><div className="col-span-2 text-center">الكمية</div><div className="col-span-2 text-center">سعر الشراء</div><div className="col-span-3 text-center">المجموع</div>
                  </div>
                  {cart.map((entry) => {
                    const lineError = cartLineError(entry);
                    const errorId = `purchase-line-error-${entry.material.id}`;
                    return (
                    <div key={entry.material.id} className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-100 p-3 text-sm dark:border-gray-800 sm:grid-cols-12 sm:items-center sm:gap-2">
                      <div className="col-span-2 min-w-0 sm:col-span-5"><p className="font-medium truncate">{entry.material.name}</p><p className="text-[11px] text-gray-500">{entry.material.unit || 'قطعة'} • الرصيد الحالي: {entry.material.quantity}</p></div>
                      <CartCell label="الكمية" className="sm:col-span-2">
                        <NumberInput
                          value={entry.quantity}
                          onValueChange={(quantity) => updateLine(entry.material.id as number, { quantity })}
                          aria-label={`كمية ${entry.material.name}`}
                          aria-invalid={lineError !== null}
                          aria-describedby={lineError ? errorId : undefined}
                          className={`h-9 w-full px-2 text-center text-sm sm:h-8 sm:text-xs ${lineError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                      </CartCell>
                      <CartCell label="سعر الشراء" className="sm:col-span-2">
                        <NumberInput
                          value={entry.purchasePrice}
                          onValueChange={(purchasePrice) => updateLine(entry.material.id as number, { purchasePrice })}
                          aria-label={`سعر شراء ${entry.material.name}`}
                          className="h-9 w-full px-2 text-center text-sm sm:h-8 sm:text-xs"
                        />
                      </CartCell>
                      <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:col-span-3 sm:gap-1">
                        <span className="shrink-0 text-[11px] text-gray-500 sm:hidden">المجموع:</span>
                        <span className="font-bold text-green-600 whitespace-nowrap text-xs">{formatCurrency(lineTotal(entry), settings?.currency)}</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-red-500 sm:h-7 sm:w-7" aria-label={`حذف ${entry.material.name}`} onClick={() => setCart((prev) => prev.filter((item) => item.material.id !== entry.material.id))}><Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></Button>
                      </div>
                      {lineError && <p id={errorId} role="alert" className="col-span-2 text-[11px] text-red-600 dark:text-red-400 sm:col-span-12">{lineError}</p>}
                    </div>
                    );
                  })}
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
              <div className="flex justify-between"><span className="text-gray-500">إجمالي الكمية:</span><strong>{roundMoney(cart.reduce((sum, entry) => sum + toFiniteNumber(entry.quantity), 0))}</strong></div>
              <div className="flex justify-between"><span className="text-gray-500">المجموع:</span><strong>{formatCurrency(subtotal, settings?.currency)}</strong></div>
              <div className="flex items-center justify-between gap-2"><span className="text-gray-500">الخصم:</span><NumberInput value={discount} onValueChange={setDiscount} aria-label="الخصم" aria-invalid={discountError !== null} className={`w-28 h-8 text-left ${discountError ? 'border-red-500' : ''}`} /></div>
              {discountError && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{discountError}</p>}
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <div className="flex justify-between text-base"><strong>الإجمالي:</strong><strong className="text-primary-600">{formatCurrency(total, settings?.currency)}</strong></div>
              {paymentMethod === 'credit' && <><div className="flex items-center justify-between gap-2"><span className="text-gray-500">المدفوع:</span><NumberInput value={paidAmount} onValueChange={setPaidAmount} aria-label="المدفوع" aria-invalid={paidError !== null} className={`w-28 h-8 text-left ${paidError ? 'border-red-500' : ''}`} /></div>{paidError && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{paidError}</p>}<div className="flex justify-between"><span className="text-gray-500">المتبقي:</span><strong className={remaining > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(remaining, settings?.currency)}</strong></div></>}
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
      <SalesVsPurchaseHelpDialog open={showHelp} onClose={() => setShowHelp(false)} />

      {previewBody && <DocumentPreviewDialog open={previewBody !== null} title={loadedPurchase?.purchaseNumber ? `وصل شراء ${formatDocumentNumber(loadedPurchase.purchaseNumber)}` : 'معاينة وصل الشراء'} bodyHtml={previewBody} fileNameBase={loadedPurchase?.purchaseNumber ? `وصل_شراء_${formatDocumentNumber(loadedPurchase.purchaseNumber)}` : `مسودة_شراء_${supplierName || 'وصل'}`} shareTitle="معاينة وصل الشراء" onClose={() => setPreviewBody(null)} />}
    </div>
  );
}
