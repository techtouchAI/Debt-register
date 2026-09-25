import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Plus, Search, Printer, Download, Trash2, DollarSign, User, FileText, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericTextInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, getSettingsOrDefault } from '@/lib/db';
import { getCustomerBalance } from '@/lib/debts';
import { savePayment, deletePayment } from '@/lib/payments';
import { printDocument, receiptDocument } from '@/lib/print';
import { saveDocumentPdf } from '@/lib/pdf';
import { openDocumentPreview } from '@/lib/documentPreview';
import { dismissOverlayThroughHistory } from '@/lib/historyTrap';
import { useModalCloser } from '@/hooks/useModalCloser';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate, formatLocalDateInput, formatLocalDateTimeInput, isSameLocalDay, roundMoney, toFiniteNumber, toISOStringOrNull } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { confirmDialog } from '@/lib/confirm';
import { documentNumberMatches, formatDocumentNumber, paymentMethodLabel } from '@/lib/labels';
import { usePermission } from '@/hooks/useSession';
import { Customer, Payment } from '@/types';

export function Payments() {
  const can = usePermission();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  // `/payments/new` مسار إجراء سريع: النموذج يفتح لأننا على هذا المسار،
  // وحالته مشتقّة من المسار لا مكتوبة داخل تأثير.
  const isNewPaymentRoute = location.pathname === '/payments/new';
  const isFormOpen = showForm || isNewPaymentRoute;
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchCustomer, setSearchCustomer] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(formatLocalDateTimeInput());
  const [method, setMethod] = useState<'cash' | 'transfer' | 'other'>('cash');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const settings = useLiveQuery(() => getSettings(), []);
  // العملة مشتقّة من الإعدادات مباشرة بدل نسخها في حالة محلية داخل تأثير
  const currency = settings?.currency || 'د.ع';

  const payments = useLiveQuery(async () => {
    const all = await db.payments.orderBy('date').reverse().toArray();
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter(
      (payment) => payment.customerName.toLowerCase().includes(query) || documentNumberMatches(payment.receiptNumber, query)
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
    const customerIdText = searchParams.get('customerId');
    const customerId = customerIdText ? Number(customerIdText) : NaN;

    // إذا وُجد customerId نملأ الزبون بعد التحقق من أن المعرّف صالح وموجود.
    // فتح النموذج نفسه مشتقّ من المسار (`isFormOpen`) — لا كتابة حالة هنا.
    if (!Number.isInteger(customerId) || customerId <= 0) return () => { cancelled = true; };

    void (async () => {
      try {
        const customer = await db.customers.get(customerId);
        if (customer && !cancelled) {
          // الاختيار فقط: النموذج مفتوح أصلاً لأننا على مسار /payments/new
          setSelectedCustomer(customer);
        }
      } catch (error) {
        if (!cancelled) reportError('Payments.preselect', error, 'تعذّر تحميل الزبون');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, searchParams]);

  const filteredCustomers = (customers ?? [])
    .filter((customer) => {
      const query = searchCustomer.trim().toLowerCase();
      if (!query) return true;
      return customer.fullName.toLowerCase().includes(query) || (customer.phone ?? '').includes(query);
    })
    .slice(0, 20);

  /** إعادة ضبط النموذج ومغادرة مسار الإجراء السريع — مُغلِق الطبقة في المكدس. */
  const resetForm = () => {
    setShowForm(false);
    setSelectedCustomer(null);
    setSearchCustomer('');
    setAmount('');
    setNotes('');
    setMethod('cash');
    setDate(formatLocalDateTimeInput());
    // عند الإغلاق من مسار الإجراء السريع نعود لصفحة التسديدات، وإلا بقي
    // النموذج مفتوحاً لأن فتحه مشتقّ من المسار.
    if (isNewPaymentRoute) navigate('/payments', { replace: true });
  };

  // أزرار الإلغاء/الحفظ تُغلق عبر السجل حتى لا يبقى مدخل `/payments/new`
  // خلف الصفحة فيعيد زر الرجوع فتح النموذج بعد إغلاقه.
  const closeForm = () => dismissOverlayThroughHistory(resetForm);

  useModalCloser(isFormOpen, resetForm);

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
      const confirmed = await confirmDialog({
        title: 'المبلغ أكبر من الدين',
        message: `المبلغ المدخل (${formatCurrency(value, currency)}) أكبر من دين الزبون (${formatCurrency(Math.max(0, customerDebt), currency)}). سيُسجَّل الفرق رصيداً للزبون.`,
        confirmText: 'متابعة التسديد',
        tone: 'warning'
      });
      if (!confirmed) return;
    }

    const dateISO = toISOStringOrNull(date);
    if (!dateISO) {
      toast.warning('تاريخ غير صالح', 'اختر تاريخ ووقت التسديد ثم أعد المحاولة');
      return;
    }

    setIsSaving(true);
    try {
      const result = await savePayment({
        customerId: selectedCustomer.id,
        amount: value,
        dateISO,
        method,
        notes
      });

      if (!result.ok) {
        toast.error('لم يتم التسديد', result.error);
        return;
      }

      toast.success(
        `تم تسديد ${formatCurrency(result.payment.amount, currency)}`,
        `رقم الوصل: ${formatDocumentNumber(result.receiptNumber)} • المتبقي: ${formatCurrency(Math.max(0, result.debtAfter), currency)}`
      );

      // الحفظ هو العملية الأساسية. بعده يُعرض الوصل في المعاينة ليختار
      // المستخدم الطباعة أو الحفظ/المشاركة — نفس السلوك على أندرويد وويندوز
      // (كان يفتح صندوق حفظ ملف تلقائياً بعد كل تسديد على ويندوز).
      closeForm();
      const receiptSettings = settings ?? (await getSettingsOrDefault());
      openDocumentPreview(receiptDocument(result.payment, receiptSettings, Math.max(0, roundMoney(result.debtAfter))));
    } catch (error) {
      reportError('Payments.save', error, 'حدث خطأ أثناء حفظ التسديد');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (payment: Payment) => {
    if (busyId !== null || !payment.id) return;
    const confirmed = await confirmDialog({
      title: `حذف وصل القبض ${formatDocumentNumber(payment.receiptNumber)}؟`,
      message: `المبلغ ${formatCurrency(payment.amount, currency)} سيعود لدين الزبون.`,
      confirmText: 'حذف الوصل',
      tone: 'danger'
    });
    if (!confirmed) return;

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
      // طباعة النظام، أو معاينة الوصل مع بديل الحفظ إن لم يتوفر حوار طباعة
      await printDocument(receiptDocument(payment, s, Math.max(0, roundMoney(balance.debt))));
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
      const saved = await saveDocumentPdf(receiptDocument(payment, s, Math.max(0, roundMoney(balance.debt))));
      if (saved) toast.success('تم حفظ الوصل كمستند', saved.message);
    } catch (error) {
      reportError('Payments.pdf', error, 'تعذّر حفظ الوصل كمستند');
    } finally {
      setBusyId(null);
    }
  };

  const handlePreview = async (payment: Payment) => {
    try {
      const s = settings ?? (await getSettingsOrDefault());
      const balance = await getCustomerBalance(payment.customerId);
      openDocumentPreview(receiptDocument(payment, s, Math.max(0, roundMoney(balance.debt))));
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
        {can('payments.create') && (
          <Button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700">
            <Plus className="w-4 h-4 ml-2" />
            تسديد دين جديد
          </Button>
        )}
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
                      <p className="font-bold">{formatDocumentNumber(payment.receiptNumber)}</p>
                      <Badge variant={payment.method === 'cash' ? 'success' : 'secondary'} className="text-[10px]">
                        {paymentMethodLabel(payment.method)}
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="معاينة الوصل" title="معاينة الوصل" onClick={() => handlePreview(payment)}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="طباعة الوصل" title="طباعة الوصل" onClick={() => handlePrintReceipt(payment)}><Printer className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="حفظ الوصل كمستند" title="حفظ الوصل كمستند" onClick={() => handleDownloadPdf(payment)}><Download className="w-4 h-4" /></Button>
                    {can('payments.delete') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        aria-label="حذف الوصل"
                        disabled={busyId === payment.id || payment.source === 'downpayment'}
                        title={payment.source === 'downpayment' ? 'دفعة مقدمة مرتبطة بفاتورة — تُحذف مع الفاتورة' : 'حذف الوصل'}
                        onClick={() => handleDelete(payment)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
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
            {can('payments.create') && <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 ml-2" />تسديد جديد</Button>}
          </CardContent>
        </Card>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto overscroll-contain" role="dialog" aria-modal="true" aria-label="نافذة القبض - تسديد دين">
            <CardContent className="p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5 text-green-600" />نافذة القبض - تسديد دين</h2>
              {/* noValidate: التحقق العربي في handleSubmit بدل فقاعات المتصفح */}
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
                    <NumericTextInput value={amount} onValueChange={setAmount} aria-required="true" className="text-lg font-bold" placeholder="مثلاً: 1000000" />
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
                    {isSaving ? 'جاري الحفظ…' : 'تأكيد التسديد وعرض الوصل'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeForm}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
