import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, Plus, Search, Printer, Download, Trash2, DollarSign, Calendar, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, getCustomerDebt, generateReceiptNumber, logActivity, createNotification } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate } from '@/lib/utils';
import { OfficeSettings, Customer, Payment } from '@/types';
import { generateReceiptPDF } from '@/lib/pdf';

export function Payments() {
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchCustomer, setSearchCustomer] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [method, setMethod] = useState<'cash' | 'transfer' | 'other'>('cash');
  const [notes, setNotes] = useState('');
  const [customerDebt, setCustomerDebt] = useState(0);

  const [searchParams] = useSearchParams();

  const payments = useLiveQuery(async () => {
    let all = await db.payments.orderBy('date').reverse().toArray();
    if (search) {
      all = all.filter(p => 
        p.customerName.toLowerCase().includes(search.toLowerCase()) ||
        p.receiptNumber.toLowerCase().includes(search.toLowerCase())
      );
    }
    return all;
  }, [search]);

  useEffect(() => {
    loadSettings();
    loadCustomers();
    const customerId = searchParams.get('customerId');
    if (customerId) {
      db.customers.get(Number(customerId)).then(c => {
        if (c) {
          setSelectedCustomer(c);
          setShowForm(true);
          getCustomerDebt(c.id!).then(setCustomerDebt);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (selectedCustomer?.id) {
      getCustomerDebt(selectedCustomer.id).then(setCustomerDebt);
    }
  }, [selectedCustomer]);

  const loadSettings = async () => {
    const s = await getSettings();
    setSettings(s || null);
  };

  const loadCustomers = async () => {
    const all = await db.customers.toArray();
    setCustomers(all);
  };

  const filteredCustomers = customers.filter(c =>
    c.fullName.toLowerCase().includes(searchCustomer.toLowerCase()) ||
    c.phone?.includes(searchCustomer)
  ).slice(0, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer?.id) {
      alert('يرجى اختيار زبون');
      return;
    }
    if (amount <= 0) {
      alert('يرجى إدخال مبلغ صحيح');
      return;
    }
    if (amount > customerDebt) {
      if (!confirm(`المبلغ المدخل (${formatCurrency(amount, settings?.currency)}) أكبر من دين الزبون (${formatCurrency(customerDebt, settings?.currency)}).\nهل تريد المتابعة؟`)) return;
    }

    try {
      const receiptNumber = await generateReceiptNumber();
      const remainingAfter = customerDebt - amount;

      const payment: Payment = {
        customerId: selectedCustomer.id!,
        customerName: selectedCustomer.fullName,
        amount,
        date: new Date(date).toISOString(),
        method,
        receiptNumber,
        remainingAfter: remainingAfter > 0 ? remainingAfter : 0,
        notes,
        createdAt: new Date().toISOString()
      };

      const id = await db.payments.add(payment);
      await logActivity('تسديد دين', `تم تسديد ${formatCurrency(amount, settings?.currency)} من الزبون ${selectedCustomer.fullName} - وصل ${receiptNumber}`, 'payment', id as number);
      
      if (remainingAfter <= 0 && customerDebt > 0) {
        await createNotification('تم تسديد الدين بالكامل', `الزبون ${selectedCustomer.fullName} سدد جميع ديونه. المبلغ: ${formatCurrency(amount, settings?.currency)}`, 'success', selectedCustomer.id, 'customer');
      }

      alert(`تم تسديد ${formatCurrency(amount, settings?.currency)} بنجاح.\nرقم الوصل: ${receiptNumber}\nالمتبقي: ${formatCurrency(remainingAfter > 0 ? remainingAfter : 0, settings?.currency)}`);
      
      setShowForm(false);
      setSelectedCustomer(null);
      setAmount(0);
      setNotes('');
      setCustomerDebt(0);
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء حفظ التسديد');
    }
  };

  const handleDelete = async (payment: Payment) => {
    if (!confirm(`هل أنت متأكد من حذف وصل القبض ${payment.receiptNumber} بمبلغ ${formatCurrency(payment.amount, settings?.currency)}؟\nسيعود المبلغ لدين الزبون.`)) return;
    
    await db.payments.delete(payment.id!);
    await logActivity('حذف تسديد', `تم حذف تسديد ${formatCurrency(payment.amount, settings?.currency)} للزبون ${payment.customerName}`, 'payment', payment.id);
  };

  const handlePrintReceipt = async (payment: Payment) => {
    const s = await getSettings();
    if (!s) return;
    const debt = await getCustomerDebt(payment.customerId);
    await generateReceiptPDF(payment, s, debt);
  };

  const totalPayments = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

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
            <p className="text-xs text-gray-500">إجمالي التسديدات</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalPayments, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">{payments?.length || 0} عملية</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">تسديدات اليوم</p>
            <p className="text-lg font-bold">{formatCurrency(payments?.filter(p => p.date.startsWith(new Date().toISOString().slice(0,10))).reduce((sum,p)=>sum+p.amount,0) || 0, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">{payments?.filter(p => p.date.startsWith(new Date().toISOString().slice(0,10))).length || 0} عملية</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">متوسط التسديد</p>
            <p className="text-lg font-bold">{formatCurrency(payments?.length ? totalPayments / payments.length : 0, settings?.currency)}</p>
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
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{payment.receiptNumber}</p>
                      <Badge variant={payment.method === 'cash' ? 'success' : 'secondary'} className="text-[10px]">
                        {payment.method === 'cash' ? 'نقدي' : payment.method === 'transfer' ? 'تحويل' : 'أخرى'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <User className="w-3 h-3" /> {payment.customerName} • {formatDate(payment.date, true)}
                    </p>
                    {payment.notes && <p className="text-xs text-gray-500 mt-1">{payment.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-3">
                  <div className="text-right">
                    <p className="font-bold text-green-600 text-lg">{formatCurrency(payment.amount, settings?.currency)}</p>
                    {payment.remainingAfter !== undefined && (
                      <p className="text-xs text-gray-500">متبقي: {formatCurrency(payment.remainingAfter, settings?.currency)}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePrintReceipt(payment)}><Printer className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDelete(payment)}><Trash2 className="w-4 h-4" /></Button>
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
          <Card className="w-full max-w-lg">
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
                      className="pr-10"
                    />
                  </div>
                  {showCustomerList && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {filteredCustomers.map(c => (
                        <button key={c.id} type="button" onClick={() => { setSelectedCustomer(c); setSearchCustomer(''); setShowCustomerList(false); }} className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <p className="font-medium text-sm">{c.fullName}</p>
                          <p className="text-xs text-gray-500">{c.phone} • {c.address}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedCustomer && (
                    <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-amber-50 to-red-50 dark:from-amber-900/20 dark:to-red-900/20 border border-amber-200 dark:border-amber-800/30">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{selectedCustomer.fullName}</span>
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setSelectedCustomer(null); setCustomerDebt(0); }}>تغيير</Button>
                      </div>
                      <div className="mt-2">
                        <p className="text-xs text-gray-600 dark:text-gray-400">إجمالي الدين الحالي</p>
                        <p className="text-lg font-bold text-red-600">{formatCurrency(customerDebt, settings?.currency)}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">المبلغ المسدد * ({settings?.currency})</label>
                    <Input type="number" min="0.01" step="0.01" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} required className="text-lg font-bold" placeholder="مثلاً: 1000000" />
                    {selectedCustomer && customerDebt > 0 && (
                      <div className="flex gap-1 mt-2">
                        <Button type="button" variant="outline" size="sm" className="text-[11px] flex-1" onClick={() => setAmount(customerDebt)}>كامل الدين</Button>
                        <Button type="button" variant="outline" size="sm" className="text-[11px] flex-1" onClick={() => setAmount(Math.round(customerDebt / 2))}>نصف الدين</Button>
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

                {selectedCustomer && amount > 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm space-y-1">
                    <div className="flex justify-between"><span>الدين الحالي:</span><span className="font-bold">{formatCurrency(customerDebt, settings?.currency)}</span></div>
                    <div className="flex justify-between"><span>المسدد الآن:</span><span className="font-bold text-green-600">{formatCurrency(amount, settings?.currency)}</span></div>
                    <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                    <div className="flex justify-between font-bold"><span>المتبقي بعد التسديد:</span><span className={customerDebt - amount > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(Math.max(0, customerDebt - amount), settings?.currency)}</span></div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 h-11 font-bold" disabled={!selectedCustomer || amount <= 0}>
                    <DollarSign className="w-4 h-4 ml-2" />
                    تأكيد التسديد وطباعة الوصل
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setSelectedCustomer(null); setAmount(0); }}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
