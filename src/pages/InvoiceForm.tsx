import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Trash2, Search, Save, Printer, Download, User, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, generateInvoiceNumber, logActivity, createNotification, checkLowStock } from '@/lib/db';
import { formatCurrency } from '@/lib/utils';
import { Material, Customer, Invoice, InvoiceItem, OfficeSettings } from '@/types';
import { generateInvoicePDF } from '@/lib/pdf';

interface CartItem {
  material: Material;
  quantity: number;
  unitPrice: number;
  total: number;
}

export function InvoiceForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;

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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [paidAmount, setPaidAmount] = useState(0);

  useEffect(() => {
    loadData();
    if (isEdit) loadInvoice();
    else {
      const customerId = searchParams.get('customerId');
      if (customerId) {
        db.customers.get(Number(customerId)).then(c => {
          if (c) {
            setSelectedCustomer(c);
            setCustomerName(c.fullName);
            setInvoiceType('credit');
          }
        });
      }
    }
  }, []);

  const loadData = async () => {
    const [s, mats, custs] = await Promise.all([
      getSettings(),
      db.materials.toArray(),
      db.customers.toArray()
    ]);
    setSettings(s || null);
    setMaterials(mats);
    setCustomers(custs);
  };

  const loadInvoice = async () => {
    if (!id) return;
    const invoice = await db.invoices.get(Number(id));
    const items = await db.invoiceItems.where('invoiceId').equals(Number(id)).toArray();
    if (!invoice) return;

    setInvoiceType(invoice.type);
    setCustomerName(invoice.customerName);
    setDiscount(invoice.discount);
    setNotes(invoice.notes || '');
    setDate(new Date(invoice.date).toISOString().slice(0, 16));
    setPaidAmount(invoice.paidAmount);

    if (invoice.customerId) {
      const c = await db.customers.get(invoice.customerId);
      if (c) setSelectedCustomer(c);
    }

    const cartItems: CartItem[] = [];
    for (const item of items) {
      const mat = await db.materials.get(item.materialId);
      if (mat) {
        // For edit, we need to add back quantity to available stock calculation
        cartItems.push({
          material: { ...mat, quantity: mat.quantity + item.quantity },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total
        });
      }
    }
    setCart(cartItems);
  };

  const filteredMaterials = materials.filter(m => 
    m.name.toLowerCase().includes(searchMaterial.toLowerCase()) ||
    m.category?.toLowerCase().includes(searchMaterial.toLowerCase())
  ).slice(0, 10);

  const filteredCustomers = customers.filter(c =>
    c.fullName.toLowerCase().includes(searchCustomer.toLowerCase()) ||
    c.phone?.includes(searchCustomer)
  ).slice(0, 10);

  const addToCart = (material: Material) => {
    const existing = cart.find(c => c.material.id === material.id);
    if (existing) {
      if (existing.quantity + 1 > material.quantity && !isEdit) {
        alert(`الكمية المتوفرة فقط ${material.quantity}`);
        return;
      }
      setCart(cart.map(c => c.material.id === material.id ? { ...c, quantity: c.quantity + 1, total: (c.quantity + 1) * c.unitPrice } : c));
    } else {
      if (material.quantity <= 0 && !isEdit) {
        alert('المادة غير متوفرة في المخزن');
        return;
      }
      setCart([...cart, { material, quantity: 1, unitPrice: material.salePrice, total: material.salePrice }]);
    }
    setSearchMaterial('');
    setShowMaterialList(false);
  };

  const updateQuantity = (materialId: number, newQty: number) => {
    if (newQty <= 0) {
      setCart(cart.filter(c => c.material.id !== materialId));
      return;
    }
    const item = cart.find(c => c.material.id === materialId);
    if (!item) return;
    if (newQty > item.material.quantity && !isEdit) {
      alert(`الكمية المتوفرة فقط ${item.material.quantity}`);
      return;
    }
    setCart(cart.map(c => c.material.id === materialId ? { ...c, quantity: newQty, total: newQty * c.unitPrice } : c));
  };

  const updatePrice = (materialId: number, newPrice: number) => {
    setCart(cart.map(c => c.material.id === materialId ? { ...c, unitPrice: newPrice, total: c.quantity * newPrice } : c));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const total = subtotal - discount;
  const remaining = invoiceType === 'credit' ? total - paidAmount : 0;

  const handleSave = async (shouldPrint = false, shouldPDF = false) => {
    if (cart.length === 0) {
      alert('يرجى إضافة مواد للفاتورة');
      return;
    }
    if (!customerName.trim()) {
      alert('يرجى إدخال اسم الزبون');
      return;
    }
    if (invoiceType === 'credit' && !selectedCustomer) {
      alert('الفواتير الآجلة يجب أن ترتبط بزبون مسجل');
      return;
    }

    try {
      const now = new Date().toISOString();
      const invoiceNumber = isEdit ? (await db.invoices.get(Number(id)))?.invoiceNumber || await generateInvoiceNumber() : await generateInvoiceNumber();

      if (isEdit) {
        // Restore old stock first
        const oldItems = await db.invoiceItems.where('invoiceId').equals(Number(id)).toArray();
        for (const oldItem of oldItems) {
          const mat = await db.materials.get(oldItem.materialId);
          if (mat) await db.materials.update(mat.id!, { quantity: mat.quantity + oldItem.quantity });
        }
        await db.invoiceItems.where('invoiceId').equals(Number(id)).delete();
      }

      // Check stock availability
      for (const item of cart) {
        const currentMat = await db.materials.get(item.material.id!);
        if (!currentMat) continue;
        if (item.quantity > currentMat.quantity) {
          alert(`المادة "${item.material.name}" كميتها غير كافية. المتوفر: ${currentMat.quantity}`);
          // Restore if edit
          if (isEdit) {
            const oldItems = await db.invoiceItems.where('invoiceId').equals(Number(id)).toArray();
            for (const oldItem of oldItems) {
              const mat = await db.materials.get(oldItem.materialId);
              if (mat) await db.materials.update(mat.id!, { quantity: mat.quantity - oldItem.quantity });
            }
          }
          return;
        }
      }

      const invoiceData: Invoice = {
        invoiceNumber,
        type: invoiceType,
        customerId: selectedCustomer?.id,
        customerName: customerName.trim(),
        itemsCount: cart.length,
        subtotal,
        discount,
        total,
        paidAmount: invoiceType === 'cash' ? total : paidAmount,
        remaining: invoiceType === 'cash' ? 0 : remaining,
        date: new Date(date).toISOString(),
        createdAt: isEdit ? (await db.invoices.get(Number(id)))?.createdAt || now : now,
        notes,
        status: invoiceType === 'cash' ? 'paid' : paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'
      };

      let invoiceId: number;
      if (isEdit) {
        await db.invoices.update(Number(id), invoiceData);
        invoiceId = Number(id);
      } else {
        invoiceId = await db.invoices.add(invoiceData) as number;
      }

      // Add items and deduct stock
      for (const item of cart) {
        await db.invoiceItems.add({
          invoiceId,
          materialId: item.material.id!,
          materialName: item.material.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          purchasePrice: item.material.purchasePrice
        });

        const mat = await db.materials.get(item.material.id!);
        if (mat) {
          await db.materials.update(mat.id!, { quantity: mat.quantity - item.quantity, updatedAt: now });
        }
      }

      await logActivity(isEdit ? 'تعديل فاتورة' : 'إنشاء فاتورة', `${isEdit ? 'تم تعديل' : 'تم إنشاء'} فاتورة ${invoiceNumber} للزبون ${customerName}`, 'invoice', invoiceId);

      if (invoiceType === 'credit' && total > 500000) {
        await createNotification('فاتورة آجلة كبيرة', `فاتورة ${invoiceNumber} بمبلغ ${formatCurrency(total, settings?.currency)} للزبون ${customerName}`, 'info', invoiceId, 'invoice');
      }

      await checkLowStock();

      if (shouldPDF || shouldPrint) {
        const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
        const s = await getSettings();
        if (s) {
          if (shouldPDF) await generateInvoicePDF({ ...invoiceData, id: invoiceId }, items, s, selectedCustomer || undefined);
          if (shouldPrint) {
            // Trigger print via generating PDF then print, or use window.print with custom content
            await generateInvoicePDF({ ...invoiceData, id: invoiceId }, items, s, selectedCustomer || undefined);
          }
        }
      }

      alert(`تم ${isEdit ? 'تعديل' : 'حفظ'} الفاتورة بنجاح: ${invoiceNumber}`);
      navigate('/invoices');
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء حفظ الفاتورة');
    }
  };

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
                  onClick={() => setInvoiceType('cash')}
                  className={`py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${invoiceType === 'cash' ? 'bg-white dark:bg-gray-700 shadow-sm text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}
                >
                  💵 نقدي - دفع فوري
                </button>
                <button
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
                      className="pr-10"
                    />
                  </div>
                  {showCustomerList && (searchCustomer || filteredCustomers.length > 0) && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          onClick={() => { setSelectedCustomer(c); setCustomerName(c.fullName); setSearchCustomer(''); setShowCustomerList(false); }}
                          className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-sm">{c.fullName}</p>
                            <p className="text-xs text-gray-500">{c.phone} • {c.address}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">مسجل</Badge>
                        </button>
                      ))}
                      {searchCustomer && (
                        <button
                          onClick={() => { setSelectedCustomer(null); setCustomerName(searchCustomer); setSearchCustomer(''); setShowCustomerList(false); }}
                          className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-t"
                        >
                          <p className="text-sm">استخدام "{searchCustomer}" كزبون عابر</p>
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
                  className="pr-10 h-12 text-base"
                />
                {showMaterialList && filteredMaterials.length > 0 && (
                  <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-80 overflow-y-auto">
                    {filteredMaterials.map(m => (
                      <button
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
                    <p className="text-sm text-gray-500">لم تتم إضافة مواد بعد</p>
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
                          <Input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateQuantity(item.material.id!, Number(e.target.value))} className="h-8 text-center" />
                        </div>
                        <div className="col-span-2">
                          <Input type="number" min="0" value={item.unitPrice} onChange={(e) => updatePrice(item.material.id!, Number(e.target.value))} className="h-8 text-center text-xs" />
                        </div>
                        <div className="col-span-2 text-center font-bold text-green-600">{formatCurrency(item.total, settings?.currency)}</div>
                        <div className="col-span-1 text-center">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setCart(cart.filter(c => c.material.id !== item.material.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
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
                <div className="flex justify-between"><span className="text-gray-500">إجمالي الكمية:</span><span className="font-bold">{cart.reduce((sum, i) => sum + i.quantity, 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">المجموع:</span><span className="font-bold">{formatCurrency(subtotal, settings?.currency)}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500 text-sm">الخصم:</span>
                  <Input type="number" min="0" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="w-28 h-8 text-left" dir="ltr" />
                </div>
                <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
                <div className="flex justify-between text-base"><span className="font-bold">الإجمالي النهائي:</span><span className="font-bold text-primary-600 text-lg">{formatCurrency(total, settings?.currency)}</span></div>
                
                {invoiceType === 'credit' && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 text-sm">المدفوع الآن:</span>
                      <Input type="number" min="0" max={total} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="w-28 h-8" />
                    </div>
                    <div className="flex justify-between"><span className="text-gray-500">المتبقي:</span><span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(remaining, settings?.currency)}</span></div>
                  </>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full min-h-[60px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" placeholder="ملاحظات إضافية..." />
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2">
                <Button onClick={() => handleSave(false, false)} className="w-full bg-primary-600 hover:bg-primary-700 h-11 font-bold" disabled={cart.length === 0}>
                  <Save className="w-4 h-4 ml-2" />
                  {isEdit ? 'حفظ التعديلات' : 'حفظ الفاتورة'}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => handleSave(true, false)} disabled={cart.length === 0}><Printer className="w-4 h-4 ml-1" />حفظ وطباعة</Button>
                  <Button variant="outline" onClick={() => handleSave(false, true)} disabled={cart.length === 0}><Download className="w-4 h-4 ml-1" />تصدير PDF</Button>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
                <p className="font-bold mb-1">💡 تلميحات:</p>
                <ul className="space-y-1 list-disc pr-4">
                  <li>يتم خصم الكميات من المخزن تلقائياً عند الحفظ</li>
                  <li>الفواتير الآجلة تضاف لديون الزبون مباشرة</li>
                  <li>يمكن تعديل السعر المفرد لكل مادة</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
