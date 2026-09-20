import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Plus, Search, Printer, Download, Trash2, DollarSign, User, FileText, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, getSettingsOrDefault } from '@/lib/db';
import { getCustomerBalance } from '@/lib/debts';
import { savePayment, deletePayment } from '@/lib/payments';
import { buildReceiptPrintHtml, printReceipt } from '@/lib/print';
import { generateReceiptPDF } from '@/lib/pdf';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { useModalCloser } from '@/hooks/useModalCloser';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate, formatLocalDateInput, formatLocalDateTimeInput, isSameLocalDay, roundMoney, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { Customer, Payment } from '@/types';

export function Payments() {
  const [searchParams] = useSearchParams();
  const [currency, setCurrency] = useState('د.ع');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchCustomer, setSearchCustomer] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(formatLocalDateTimeInput());
  const [method, setMethod] = useState<'cash' | 'transfer' | 'other'>('cash');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [previewPayment, setPreviewPayment] = useState<Payment | null>(null);
  const [previewDebt, setPreviewDebt] = useState(0);

  const settings = useLiveQuery(() => getSettings(), []);
  useEffect(() => {
    if (settings?.currency) setCurrency(settings.currency);
  }, [settings?.currency]);

  const payments = useLiveQuery(async () => {
    const all = await db.payments.orderBy('date').reverse().toArray();
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter(
      (payment) =>
        payment.customerName.toLowerCase().includes(query) || payment.receiptNumber.toLowerCase().includes(query)
    );
  }, [search]);

  const customers = useLiveQuery(() => db.customers.toArray(), []);

  // رصيد الزبون المختار يُحسب مباشرة من السجلات ويتحدث تلقائياً
  const customerBalance = useLiveQuery(
    async () => (selectedCustomer?.id ? getCustomerBalance(selectedCustomer.id) : null),
    [selectedCustomer?.id]
  );
  const customerDebt = customerBalance ? roundMoney(customerBalance.debt) : 0;

  const today = formatLocalDateInput();

  useEffect(() => {
    let cancelled = false;
    const customerId = searchParams.get('customerId');
    if (!customerId) return;
    void (async () => {
      try {
        const customer = await db.customers.get(Number(customerId));
        if (customer && !cancelled) {
          setSelectedCustomer(customer);
          setShowForm(true);
        }
      } catch (error) {
        if (!cancelled) reportError('Payments.preselect', error, 'تعذّر تحميل الزبون');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const filteredCustomers = (customers ?? [])
    .filter((customer) => {
      const query = searchCustomer.trim().toLowerCase();
      if (!query) return true;
      return customer.fullName.toLowerCase().includes(query) || (customer.phone ?? '').includes(query);
    })
    .slice(0, 20);

  const closeForm = () => {
    setShowForm(false);
    setSelectedCustomer(null);
    setSearchCustomer('');
    setAmount('');
    setNotes('');
    setMethod('cash');
    setDate(formatLocalDateTimeInput());
  };

  useModalCloser(showForm, closeForm);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!selectedCustomer?.id) {
      toast.warning('اختر زبوناً', 'لا يمكن تسجيل تسديد بدون زبون');
      return;
    }
    const value = roundMoney(toFiniteNumber(amount, NaN));
    if (!Number.isFinite(value) || value <= 0) {
      toast.warning('مبلغ غير صالح', 'أدخل مبلغاً أكبر من صفر');
      return;
    }
    if (value > customerDebt) {
      const confirmed = confirm(
        `المبلغ المدخل (${formatCurrency(value, currency)}) أكبر من دين الزبون (${formatCurrency(customerDebt, currency)}).\nهل تريد المتابعة؟`
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    try {
      const result = await savePayment({
        customerId: selectedCustomer.id,
        amount: value,
        dateISO: new Date(date).toISOString(),
        method,
        notes
      });

      if (!result.ok) {
        toast.error('لم يتم التسديد', result.error);
        return;
      }

      toast.success(
        `تم تسديد ${formatCurrency(result.payment.amount, currency)}`,
        `رقم الوصل: ${result.receiptNumber} • المتبقي: ${formatCurrency(Math.max(0, result.debtAfter), currency)}`
      );

      const s = await getSettingsOrDefault();
      await generateReceiptPDF(result.payment, s, Math.max(0, result.debtAfter));
      closeForm();
    } catch (error) {
      reportError('Payments.save', error, 'حدث خطأ أثناء حفظ التسديد');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (payment: Payment) => {
    if (busyId !== null || !payment.id) return;
    if (!confirm(`هل أنت متأكد من حذف وصل القبض ${payment.receiptNumber} بمبلغ ${formatCurrency(payment.amount, currency)}؟\nسيعود المبلغ لدين الزبون.`)) return;

    setBusyId(payment.id);
    try {
      const result = await deletePayment(payment.id);
      if (!result.ok) {
        toast.error('تعذّر الحذف', result.error);
        return;
      }
      toast.success('تم حذف الوصل', 'حُدِّث رصيد الزبون وفواتيره');
    } catch (error) {
      reportError('Payments.delete', error, 'حدث خطأ أثناء حذف التسديد');
    } finally {
      setBusyId(null);
    }
  };

  const handlePrintReceipt = async (payment: Payment) => {
    if (busyId !== null) return;
    setBusyId(payment.id ?? -1);
    try {
      const s = await getSettingsOrDefault();
      const balance = await getCustomerBalance(payment.customerId);
      const opened = await printReceipt(payment, s, Math.max(0, balance.debt));
      if (!opened) {
        // لا حوار طباعة (أندرويد أصلي): نفتح المعاينة مع زر PDF بدل لا شيء
        setPreviewDebt(Math.max(0, roundMoney(balance.debt)));
        setPreviewPayment(payment);
      }
    } catch (error) {
      reportError('Payments.print', error, 'تعذّر طباعة الوصل');
    } finally {
      setBusyId(null);
    }
  };

  const handleDownloadPdf = async (payment: Payment) => {
    if (busyId !== null) return;
    setBusyId(payment.id ?? -1);
    try {
      const s = await getSettingsOrDefault();
      const balance = await getCustomerBalance(payment.customerId);
      const fileName = await generateReceiptPDF(payment, s, Math.max(0, roundMoney(balance.debt)));
      toast.success('تم إنشاء ملف PDF', fileName);
    } catch (error) {
      reportError('Payments.pdf', error, 'تعذّر إنشاء ملف PDF');
    } finally {
      setBusyId(null);
    }
  };

  const handlePreview = async (payment: Payment) => {
    try {
      const balance = await getCustomerBalance(payment.customerId);
      setPreviewDebt(Math.max(0, roundMoney(balance.debt)));
      setPreviewPayment(payment);
    } catch (error) {
      reportError('Payments.preview', error, 'تعذّر فتح المعاينة');
    }
  };

  const totalPayments = roundMoney((payments ?? []).reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));
  const todayPayments = (payments ?? []).filter((payment) => isSameLocalDay(payment.date, today));
  const todayTotal = roundMoney(todayPayments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-primary-600" />
            الديون والتسديدات
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">متابعة تسديدات الزبائن وطباعة وصولات القبض</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 ml-2" />
          تسديد دين جديد
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">إجمالي التسديدات المعروضة</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalPayments, currency)}</p>
            <p className="text-[11px] text-gray-500">{payments?.length || 0} عملية</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">تسديدات اليوم</p>
            <p className="text-lg font-bold">{formatCurrency(todayTotal, currency)}</p>
            <p className="text-[11px] text-gray-500">{todayPayments.length} عملية</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">متوسط التسديد</p>
            <p className="text-lg font-bold">
              {formatCurrency(payments?.length ? totalPayments / payments.length : 0, currency)}
            </p>
            <p className="text-[11px] text-gray-500">لكل عملية</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="بحث باسم الزبون أو رقم الوصل..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {payments?.map((payment) => (
          <Card key={payment.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold">{payment.receiptNumber}</p>
                      <Badge variant={payment.method === 'cash' ? 'success' : 'secondary'} className="text-[10px]">
                        {payment.method === 'cash' ? 'نقدي' : payment.method === 'transfer' ? 'تحويل' : 'أخرى'}
                      </Badge>
                      {payment.source === 'downpayment' && (
                        <Badge variant="outline" className="text-[10px] flex items-center gap-1">
                          <FileText className="w-3 h-3" /> دفعة مقدمة
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <User className="w-3 h-3" /> {payment.customerName} • {formatDate(payment.date, true)}
                    </p>
                    {payment.notes && <p className="text-xs text-gray-500 mt-1">{payment.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-3">
                  <div className="text-right">
                    <p className="font-bold text-green-600 text-lg">{formatCurrency(payment.amount, currency)}</p>
                    {payment.remainingAfter !== undefined && (
                      <p className="text-xs text-gray-500">متبقي: {formatCurrency(payment.remainingAfter, currency)}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="معاينة الوصل" onClick={() => handlePreview(payment)}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="طباعة الوصل" onClick={() => handlePrintReceipt(payment)}><Printer className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="تنزيل PDF" onClick={() => handleDownloadPdf(payment)}><Download className="w-4 h-4" /></Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600"
                      aria-label="حذف الوصل"
                      disabled={busyId === payment.id || payment.source === 'downpayment'}
                      title={payment.source === 'downpayment' ? 'دفعة مقدمة مرتبطة بفاتورة' : undefined}
                      onClick={() => handleDelete(payment)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {payments?.length === 0 && (
        <Card className="border-0 shadow-md">
          <CardContent className="text-center py-16">
            <CreditCard className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="font-bold mb-2">لا توجد تسديدات</h3>
            <p className="text-sm text-gray-500 mb-4">ابدأ بتسجيل تسديد جديد</p>
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 ml-2" />تسديد جديد</Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <CardContent className="p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5 text-green-600" />نافذة القبض - تسديد دين</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <label className="text-sm font-medium mb-1 block">الزبون *</label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="ابحث باسم الزبون..."
                      value={searchCustomer || selectedCustomer?.fullName || ''}
                      onChange={(e) => { setSearchCustomer(e.target.value); setShowCustomerList(true); }}
                      onFocus={() => setShowCustomerList(true)}
                      onBlur={() => window.setTimeout(() => setShowCustomerList(false), 150)}
                      className="pr-10"
                    />
                  </div>
                  {showCustomerList && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {filteredCustomers.map(c => (
                        <button type="button" key={c.id} onClick={() => { setSelectedCustomer(c); setSearchCustomer(''); setShowCustomerList(false); }} className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <p className="font-medium text-sm">{c.fullName}</p>
                          <p className="text-xs text-gray-500">{c.phone || 'بدون هاتف'} {c.address ? `• ${c.address}` : ''}</p>
                        </button>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <p className="p-3 text-sm text-gray-500">لا يوجد زبون بهذا الاسم</p>
                      )}
                    </div>
                  )}
                  {selectedCustomer && (
                    <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-amber-50 to-red-50 dark:from-amber-900/20 dark:to-red-900/20 border border-amber-200 dark:border-amber-800/30">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{selectedCustomer.fullName}</span>
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setSelectedCustomer(null); }}>تغيير</Button>
                      </div>
                      <div className="mt-2">
                        <p className="text-xs text-gray-600 dark:text-gray-400">إجمالي الدين الحالي</p>
                        <p className="text-lg font-bold text-red-600">{formatCurrency(Math.max(0, customerDebt), currency)}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">المبلغ المسدد * ({currency})</label>
                    <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required className="text-lg font-bold" placeholder="مثلاً: 1000000" />
                    {selectedCustomer && customerDebt > 0 && (
                      <div className="flex gap-1 mt-2">
                        <Button type="button" variant="outline" size="sm" className="text-[11px] flex-1" onClick={() => setAmount(String(roundMoney(customerDebt)))}>كامل الدين</Button>
                        <Button type="button" variant="outline" size="sm" className="text-[11px] flex-1" onClick={() => setAmount(String(Math.round(customerDebt / 2)))}>نصف الدين</Button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">تاريخ التسديد</label>
                    <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">طريقة الدفع</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setMethod('cash')} className={`p-2.5 rounded-xl border text-sm font-medium transition-all ${method === 'cash' ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>نقدي</button>
                    <button type="button" onClick={() => setMethod('transfer')} className={`p-2.5 rounded-xl border text-sm font-medium transition-all ${method === 'transfer' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>تحويل</button>
                    <button type="button" onClick={() => setMethod('other')} className={`p-2.5 rounded-xl border text-sm font-medium transition-all ${method === 'other' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>أخرى</button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                  <Input placeholder="ملاحظات اختيارية..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                {selectedCustomer && toFiniteNumber(amount) > 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm space-y-1">
                    <div className="flex justify-between"><span>الدين الحالي:</span><span className="font-bold">{formatCurrency(Math.max(0, customerDebt), currency)}</span></div>
                    <div className="flex justify-between"><span>المسدد الآن:</span><span className="font-bold text-green-600">{formatCurrency(roundMoney(toFiniteNumber(amount)), currency)}</span></div>
                    <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                    <div className="flex justify-between font-bold">
                      <span>المتبقي بعد التسديد:</span>
                      <span className={customerDebt - toFiniteNumber(amount) > 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatCurrency(Math.max(0, roundMoney(customerDebt - toFiniteNumber(amount))), currency)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 h-11 font-bold" disabled={!selectedCustomer || isSaving}>
                    <DollarSign className="w-4 h-4 ml-2" />
                    {isSaving ? 'جاري الحفظ…' : 'تأكيد التسديد وطباعة الوصل'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeForm}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {previewPayment && (
        <DocumentPreviewDialog
          open={previewPayment !== null}
          title={`وصل قبض ${previewPayment.receiptNumber}`}
          bodyHtml={buildReceiptPrintHtml(previewPayment, settings ?? { officeName: '', phone: '', address: '', currency, lowStockThreshold: 5, theme: 'light', autoBackupEnabled: true, autoBackupInterval: 60, language: 'ar' }, previewDebt)}
          fileNameBase={previewPayment.receiptNumber}
          pdfFormat="receipt80"
          shareTitle={`وصل قبض ${previewPayment.receiptNumber}`}
          onClose={() => setPreviewPayment(null)}
        />
      )}
    </div>
  );
}
