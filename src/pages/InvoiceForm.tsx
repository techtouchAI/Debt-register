import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Trash2, Search, Save, Printer, Download, User, Package, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, getSettingsOrDefault, checkLowStock } from '@/lib/db';
import { saveInvoice, getInvoiceWithItems, type InvoiceDraft } from '@/lib/invoices';
import { formatCurrency, formatLocalDateTimeInput, roundMoney, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { Material, Customer, OfficeSettings } from '@/types';
import { generateInvoicePDF } from '@/lib/pdf';

interface CartItem {
  material: Material;
  quantity: number;
  unitPrice: number;
  total: number;
}

const EMPTY_CART_MESSAGE = 'لم تتم إضافة مواد بعد';

export function InvoiceForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const invoiceId = id ? Number(id) : undefined;
  const isEdit = Number.isFinite(invoiceId as number) && (invoiceId as number) > 0;

  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchMaterial, setSearchMaterial] = useState('');
  const [searchCustomer, setSearchCustomer] = useState('');
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(false);

  const [invoiceType, setInvoiceType] = useState<'cash' | 'credit'>('cash');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(formatLocalDateTimeInput());
  const [paidAmount, setPaidAmount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [s, mats, custs] = await Promise.all([getSettings(), db.materials.toArray(), db.customers.toArray()]);
        if (cancelled) return;
        setSettings(s || null);
        setMaterials(mats);
        setCustomers(custs);

        if (isEdit) {
          const found = await getInvoiceWithItems(invoiceId as number);
          if (!found) {
            toast.error('الفاتورة غير موجودة', 'ربما تم حذفها من جهاز آخر أو من النسخ الاحتياطية');
            navigate('/invoices', { replace: true });
            return;
          }
          if (cancelled) return;

          const { invoice, items } = found;
          setInvoiceType(invoice.type);
          setCustomerName(invoice.customerName);
          setDiscount(toFiniteNumber(invoice.discount));
          setNotes(invoice.notes || '');
          setDate(formatLocalDateTimeInput(new Date(invoice.date)));
          setPaidAmount(toFiniteNumber(invoice.paidAmount));

          const linkedCustomer = invoice.customerId ? await db.customers.get(invoice.customerId) : undefined;
          if (cancelled) return;
          if (linkedCustomer) setSelectedCustomer(linkedCustomer);

          const stockById = new Map(mats.map((material) => [material.id, material]));
          const reserved = new Map<number, number>();
          for (const item of items) {
            reserved.set(item.materialId, roundMoney((reserved.get(item.materialId) ?? 0) + item.quantity));
          }

          const cartItems: CartItem[] = [];
          for (const item of items) {
            const material = stockById.get(item.materialId);
            if (!material) continue;
            cartItems.push({
              // الكمية المعروضة تشمل حصة هذه الفاتورة حتى يمكن تعديلها بحرية
              material: { ...material, quantity: roundMoney(material.quantity + (reserved.get(item.materialId) ?? 0)) },
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total
            });
          }
          setCart(cartItems);
          return;
        }

        const customerIdParam = searchParams.get('customerId');
        if (customerIdParam) {
          const customer = await db.customers.get(Number(customerIdParam));
          if (customer && !cancelled) {
            setSelectedCustomer(customer);
            setCustomerName(customer.fullName);
            setInvoiceType('credit');
          }
        }
      } catch (error) {
        if (!cancelled) reportError('InvoiceForm.load', error, 'تعذّر تحميل بيانات الفاتورة');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredMaterials = useMemo(() => {
    const query = searchMaterial.trim().toLowerCase();
    if (!query) return [];
    return materials
      .filter(
        (material) =>
          material.name.toLowerCase().includes(query) ||
          (material.category ?? '').toLowerCase().includes(query) ||
          (material.barcode ?? '').includes(query)
      )
      .slice(0, 20);
  }, [materials, searchMaterial]);

  const filteredCustomers = useMemo(() => {
    const query = searchCustomer.trim().toLowerCase();
    return customers
      .filter(
        (customer) =>
          customer.fullName.toLowerCase().includes(query) || (customer.phone ?? '').includes(searchCustomer.trim())
      )
      .slice(0, 20);
  }, [customers, searchCustomer]);

  const addToCart = (material: Material) => {
    const existing = cart.find((item) => item.material.id === material.id);
    if (existing) {
      if (roundMoney(existing.quantity + 1) > material.quantity) {
        toast.warning('الكمية غير كافية', `المتوفر من "${material.name}": ${material.quantity} ${material.unit ?? ''}`);
        return;
      }
      setCart(
        cart.map((item) =>
          item.material.id === material.id
            ? { ...item, quantity: roundMoney(item.quantity + 1), total: roundMoney((item.quantity + 1) * item.unitPrice) }
            : item
        )
      );
    } else {
      if (material.quantity <= 0) {
        toast.warning('المادة غير متوفرة', `لا توجد كمية متوفرة من "${material.name}"`);
        return;
      }
      setCart([
        ...cart,
        { material, quantity: 1, unitPrice: toFiniteNumber(material.salePrice), total: roundMoney(toFiniteNumber(material.salePrice)) }
      ]);
    }
    setSearchMaterial('');
    setShowMaterialList(false);
  };

  const updateQuantity = (materialId: number, value: string) => {
    const quantity = toFiniteNumber(value, NaN);
    if (value.trim() === '' || !Number.isFinite(quantity)) {
      setCart(cart.filter((item) => item.material.id !== materialId));
      return;
    }
    if (quantity <= 0) {
      setCart(cart.filter((item) => item.material.id !== materialId));
      return;
    }
    const item = cart.find((entry) => entry.material.id === materialId);
    if (!item) return;
    if (quantity > item.material.quantity) {
      toast.warning('الكمية غير كافية', `المتوفر من "${item.material.name}": ${item.material.quantity}`);
      return;
    }
    setCart(
      cart.map((entry) =>
        entry.material.id === materialId
          ? { ...entry, quantity, total: roundMoney(quantity * entry.unitPrice) }
          : entry
      )
    );
  };

  const updatePrice = (materialId: number, value: string) => {
    const unitPrice = Math.max(0, toFiniteNumber(value));
    setCart(
      cart.map((item) =>
        item.material.id === materialId
          ? { ...item, unitPrice, total: roundMoney(item.quantity * unitPrice) }
          : item
      )
    );
  };

  const subtotal = roundMoney(cart.reduce((sum, item) => sum + toFiniteNumber(item.total), 0));
  const safeDiscount = Math.min(Math.max(roundMoney(toFiniteNumber(discount)), 0), subtotal);
  const total = roundMoney(subtotal - safeDiscount);
  const safePaid = Math.min(Math.max(roundMoney(toFiniteNumber(paidAmount)), 0), total);
  const remaining = invoiceType === 'credit' ? roundMoney(total - safePaid) : 0;

  const handleSave = async (shouldPDF = false) => {
    if (isSaving) return;
    if (cart.length === 0) {
      toast.warning('لا توجد مواد', 'أضف مادة واحدة على الأقل للفاتورة');
      return;
    }

    setIsSaving(true);
    try {
      const draft: InvoiceDraft = {
        id: isEdit ? invoiceId : undefined,
        type: invoiceType,
        customerId: selectedCustomer?.id,
        customerName,
        dateISO: new Date(date).toISOString(),
        discount: safeDiscount,
        paidAmount: invoiceType === 'credit' ? safePaid : 0,
        notes,
        items: cart.map((item) => ({
          materialId: item.material.id as number,
          materialName: item.material.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          purchasePrice: item.material.purchasePrice
        }))
      };

      const result = await saveInvoice(draft);
      if (!result.ok) {
        toast.error('لم يتم الحفظ', result.error);
        return;
      }

      if (shouldPDF) {
        const s = await getSettingsOrDefault();
        const customer = draft.customerId ? await db.customers.get(draft.customerId) : undefined;
        await generateInvoicePDF(result.invoice, result.items, s, customer);
      }

      toast.success(isEdit ? 'تم تحديث الفاتورة' : 'تم حفظ الفاتورة', `رقم الفاتورة: ${result.invoiceNumber}`);
      navigate('/invoices');
    } catch (error) {
      reportError('InvoiceForm.save', error, 'حدث خطأ أثناء حفظ الفاتورة');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintPreview = async () => {
    if (cart.length === 0) {
      toast.warning('لا توجد مواد', 'أضف مادة واحدة على الأقل قبل الطباعة');
      return;
    }
    try {
      const s = await getSettingsOrDefault();
      const previewInvoice = {
        invoiceNumber: 'مسودة',
        type: invoiceType,
        customerName: customerName || '—',
        itemsCount: cart.length,
        subtotal,
        discount: safeDiscount,
        total,
        paidAmount: invoiceType === 'cash' ? total : safePaid,
        remaining,
        date: new Date(date).toISOString(),
        createdAt: new Date().toISOString(),
        status: 'unpaid' as const
      };
      await generateInvoicePDF(
        previewInvoice,
        cart.map((item) => ({
          invoiceId: 0,
          materialId: item.material.id as number,
          materialName: item.material.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total
        })),
        s,
        selectedCustomer || undefined
      );
      await checkLowStock();
    } catch (error) {
      reportError('InvoiceForm.print', error, 'تعذّر إنشاء نسخة الطباعة');
    }
  };

  const saveButtonLabel = isSaving ? 'جاري الحفظ…' : isEdit ? 'حفظ التعديلات' : 'حفظ الفاتورة';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary-600" />
            {isEdit ? 'تعديل فاتورة' : 'فاتورة بيع جديدة'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">الفاتورة الذكية - بحث سريع وحساب تلقائي</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/invoices')}>رجوع للفواتير</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice Type & Customer */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />بيانات الفاتورة والزبون</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setInvoiceType('cash')}
                  className={`py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${invoiceType === 'cash' ? 'bg-white dark:bg-gray-700 shadow-sm text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}
                >
                  💵 نقدي - دفع فوري
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceType('credit')}
                  className={`py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${invoiceType === 'credit' ? 'bg-white dark:bg-gray-700 shadow-sm text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}
                >
                  📝 آجل - دين
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="text-sm font-medium mb-1 block">الزبون *</label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder={invoiceType === 'cash' ? 'اسم الزبون (عابر أو مسجل)' : 'اختر زبون مسجل للآجل...'}
                      value={searchCustomer || customerName}
                      onChange={(e) => { setSearchCustomer(e.target.value); setCustomerName(e.target.value); setShowCustomerList(true); }}
                      onFocus={() => setShowCustomerList(true)}
                      onBlur={() => window.setTimeout(() => setShowCustomerList(false), 150)}
                      className="pr-10"
                    />
                  </div>
                  {showCustomerList && (searchCustomer || filteredCustomers.length > 0) && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {filteredCustomers.map(c => (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => { setSelectedCustomer(c); setCustomerName(c.fullName); setSearchCustomer(''); setShowCustomerList(false); }}
                          className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-sm">{c.fullName}</p>
                            <p className="text-xs text-gray-500">{c.phone || 'بدون هاتف'} {c.address ? `• ${c.address}` : ''}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">مسجل</Badge>
                        </button>
                      ))}
                      {searchCustomer && (
                        <button
                          type="button"
                          onClick={() => { setSelectedCustomer(null); setCustomerName(searchCustomer); setSearchCustomer(''); setShowCustomerList(false); }}
                          className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-t"
                        >
                          <p className="text-sm">استخدام &quot;{searchCustomer}&quot; كزبون عابر</p>
                          <p className="text-xs text-gray-500">للبيع النقدي فقط</p>
                        </button>
                      )}
                    </div>
                  )}
                  {selectedCustomer && (
                    <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-between">
                      <span className="text-xs text-green-700 dark:text-green-400">✓ زبون مسجل: {selectedCustomer.fullName}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => { setSelectedCustomer(null); setCustomerName(''); }}>إزالة</Button>
                    </div>
                  )}
                  {invoiceType === 'credit' && !selectedCustomer && (
                    <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                      الفواتير الآجلة تحتاج زبوناً مسجلاً حتى يُحسب الدين بشكل صحيح.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">تاريخ الفاتورة</label>
                  <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Add Materials - Smart Invoice */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" />إضافة المواد (الفاتورة الذكية)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="ابحث باسم المادة... مثلاً: مبيد عناكب، سماد..."
                  value={searchMaterial}
                  onChange={(e) => { setSearchMaterial(e.target.value); setShowMaterialList(true); }}
                  onFocus={() => setShowMaterialList(true)}
                  onBlur={() => window.setTimeout(() => setShowMaterialList(false), 150)}
                  className="pr-10 h-12 text-base"
                />
                {showMaterialList && searchMaterial.trim() && filteredMaterials.length === 0 && (
                  <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-sm text-gray-500">
                    لا توجد مادة بهذا الاسم
                  </div>
                )}
                {showMaterialList && filteredMaterials.length > 0 && (
                  <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-80 overflow-y-auto">
                    {filteredMaterials.map(m => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => addToCart(m)}
                        className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between border-b last:border-0 border-gray-100 dark:border-gray-700/50"
                      >
                        <div className="text-right">
                          <p className="font-medium text-sm">{m.name}</p>
                          <p className="text-xs text-gray-500">{m.category} • متوفر: {m.quantity} {m.unit} • {formatCurrency(m.salePrice, settings?.currency)}</p>
                        </div>
                        <Plus className="w-4 h-4 text-primary-600" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart */}
              <div className="space-y-3">
                {cart.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                    <Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">{EMPTY_CART_MESSAGE}</p>
                    <p className="text-xs text-gray-400 mt-1">ابحث واختر المادة لإضافتها تلقائياً</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-3 grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-600 dark:text-gray-400">
                      <div className="col-span-5">المادة</div>
                      <div className="col-span-2 text-center">الكمية</div>
                      <div className="col-span-2 text-center">السعر المفرد</div>
                      <div className="col-span-2 text-center">المجموع</div>
                      <div className="col-span-1"></div>
                    </div>
                    {cart.map((item) => (
                      <div key={item.material.id} className="p-3 grid grid-cols-12 gap-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm">
                        <div className="col-span-5">
                          <p className="font-medium truncate">{item.material.name}</p>
                          <p className="text-[11px] text-gray-500">متوفر: {item.material.quantity}</p>
                        </div>
                        <div className="col-span-2">
                          <Input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateQuantity(item.material.id as number, e.target.value)} className="h-8 text-center" />
                        </div>
                        <div className="col-span-2">
                          <Input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updatePrice(item.material.id as number, e.target.value)} className="h-8 text-center text-xs" />
                        </div>
                        <div className="col-span-2 text-center font-bold text-green-600">{formatCurrency(item.total, settings?.currency)}</div>
                        <div className="col-span-1 text-center">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" aria-label={`حذف ${item.material.name}`} onClick={() => setCart(cart.filter(c => c.material.id !== item.material.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card className="border-0 shadow-md sticky top-24">
            <CardHeader>
              <CardTitle className="text-base">ملخص الفاتورة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">عدد المواد:</span><span className="font-bold">{cart.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">إجمالي الكمية:</span><span className="font-bold">{roundMoney(cart.reduce((sum, i) => sum + i.quantity, 0))}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">المجموع:</span><span className="font-bold">{formatCurrency(subtotal, settings?.currency)}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500 text-sm">الخصم:</span>
                  <Input type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={(e) => setDiscount(toFiniteNumber(e.target.value))} className="w-28 h-8 text-left" dir="ltr" />
                </div>
                <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
                <div className="flex justify-between text-base"><span className="font-bold">الإجمالي النهائي:</span><span className="font-bold text-primary-600 text-lg">{formatCurrency(total, settings?.currency)}</span></div>

                {invoiceType === 'credit' && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 text-sm">المدفوع الآن:</span>
                      <Input type="number" min="0" max={total} step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(toFiniteNumber(e.target.value))} className="w-28 h-8" />
                    </div>
                    <div className="flex justify-between"><span className="text-gray-500">المتبقي:</span><span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(remaining, settings?.currency)}</span></div>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      تُسجَّل الدفعة كوصل قبض، ويُوزَّع المسدد تلقائياً على أقدم فواتير الزبون.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full min-h-[60px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" placeholder="ملاحظات إضافية..." />
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2">
                <Button onClick={() => handleSave(false)} className="w-full bg-primary-600 hover:bg-primary-700 h-11 font-bold" disabled={cart.length === 0 || isSaving}>
                  {isSaving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                  {saveButtonLabel}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => handleSave(true)} disabled={cart.length === 0 || isSaving}>
                    <Download className="w-4 h-4 ml-1" />حفظ و PDF
                  </Button>
                  <Button variant="outline" onClick={handlePrintPreview} disabled={cart.length === 0 || isSaving}>
                    <Printer className="w-4 h-4 ml-1" />معاينة PDF
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
                <p className="font-bold mb-1">💡 تلميحات:</p>
                <ul className="space-y-1 list-disc pr-4">
                  <li>يتم خصم الكميات من المخزن تلقائياً عند الحفظ</li>
                  <li>الفواتير الآجلة تضاف لديون الزبون مباشرة</li>
                  <li>لا يُحفظ شيء إذا كانت الكمية غير كافية</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
