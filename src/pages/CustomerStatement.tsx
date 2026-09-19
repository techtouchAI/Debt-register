import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, CreditCard, DollarSign, Printer, Download, Calendar, Phone, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, getCustomerDebt } from '@/lib/db';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Customer, Invoice, Payment, OfficeSettings } from '@/types';
import { generateCustomerStatementPDF } from '@/lib/pdf';

export function CustomerStatement() {
  const { id } = useParams();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [debt, setDebt] = useState(0);
  const [filter, setFilter] = useState<'all' | 'invoices' | 'payments'>('all');

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    const customerId = Number(id);
    const [c, s] = await Promise.all([
      db.customers.get(customerId),
      getSettings()
    ]);
    setCustomer(c || null);
    setSettings(s || null);

    const [invs, pays, d] = await Promise.all([
      db.invoices.where('customerId').equals(customerId).reverse().sortBy('date'),
      db.payments.where('customerId').equals(customerId).reverse().sortBy('date'),
      getCustomerDebt(customerId)
    ]);

    setInvoices(invs);
    setPayments(pays);
    setDebt(d);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    if (!customer || !settings) return;
    await generateCustomerStatementPDF(customer, invoices, payments, settings, debt);
  };

  const totalInvoices = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  const timeline = [
    ...invoices.map(inv => ({ type: 'invoice' as const, date: inv.date, data: inv })),
    ...payments.map(p => ({ type: 'payment' as const, date: p.date, data: p }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filteredTimeline = timeline.filter(item => {
    if (filter === 'invoices') return item.type === 'invoice';
    if (filter === 'payments') return item.type === 'payment';
    return true;
  });

  if (!customer) {
    return (
      <div className="text-center py-16">
        <p>الزبون غير موجود</p>
        <Link to="/customers"><Button className="mt-4">رجوع للعملاء</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/customers">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">كشف حساب الزبون</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">سجل زمني تفصيلي لجميع مسحوبات ومدفوعات الزبون</p>
        </div>
      </div>

      {/* Customer Card */}
      <Card className="border-0 shadow-md overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-primary-600 to-green-600" />
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-green-600 flex items-center justify-center text-white font-bold text-2xl">
                {customer.fullName.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{customer.fullName}</h2>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {customer.phone && <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{customer.phone}</span>}
                  {customer.address && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{customer.address}</span>}
                  <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />عميل منذ {new Date(customer.createdAt).toLocaleDateString('ar-EG')}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 ml-2" />طباعة</Button>
              <Button variant="outline" onClick={handleExportPDF}><Download className="w-4 h-4 ml-2" />PDF</Button>
              <Link to={`/invoices/new?customerId=${customer.id}`}><Button className="bg-primary-600 hover:bg-primary-700">فاتورة جديدة</Button></Link>
              <Link to={`/payments/new?customerId=${customer.id}`}><Button className="bg-green-600 hover:bg-green-700">تسديد دين</Button></Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
              <p className="text-xs text-gray-500">إجمالي المسحوبات</p>
              <p className="text-lg font-bold">{formatCurrency(totalInvoices, settings?.currency)}</p>
              <p className="text-[11px] text-gray-500">{invoices.length} فاتورة آجلة</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-200 dark:border-green-800/30">
              <p className="text-xs text-green-700 dark:text-green-400">إجمالي المدفوع</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(totalPaid, settings?.currency)}</p>
              <p className="text-[11px] text-green-600">{payments.length} عملية تسديد</p>
            </div>
            <div className={`rounded-xl p-4 border ${debt > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/30'}`}>
              <p className={`text-xs ${debt > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>الرصيد المتبقي</p>
              <p className={`text-xl font-bold ${debt > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(debt, settings?.currency)}</p>
              <p className="text-[11px] text-gray-500">{debt > 0 ? 'مبلغ مطلوب' : 'خالص'}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800/30">
              <p className="text-xs text-blue-700 dark:text-blue-400">آخر نشاط</p>
              <p className="text-sm font-bold">{timeline[0] ? formatDate(timeline[0].date) : 'لا يوجد'}</p>
              <p className="text-[11px] text-blue-600">{timeline[0]?.type === 'invoice' ? 'فاتورة' : timeline[0]?.type === 'payment' ? 'تسديد' : ''}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex gap-2">
            <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>الكل ({timeline.length})</Button>
            <Button variant={filter === 'invoices' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('invoices')}>الفواتير ({invoices.length})</Button>
            <Button variant={filter === 'payments' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('payments')}>التسديدات ({payments.length})</Button>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />السجل الزمني التفصيلي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredTimeline.length ? filteredTimeline.map((item, idx) => (
              <div key={idx} className="relative flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${item.type === 'invoice' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'}`}>
                    {item.type === 'invoice' ? <FileText className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                  </div>
                  {idx !== filteredTimeline.length - 1 && <div className="w-px h-full bg-gray-200 dark:bg-gray-700 mt-2" />}
                </div>
                <div className="flex-1 pb-6">
                  <div className={`p-4 rounded-xl border ${item.type === 'invoice' ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' : 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30'}`}>
                    {item.type === 'invoice' ? (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <p className="font-bold">{(item.data as Invoice).invoiceNumber}</p>
                            <Badge variant={(item.data as Invoice).status === 'paid' ? 'success' : (item.data as Invoice).status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                              {(item.data as Invoice).status === 'paid' ? 'مدفوعة' : (item.data as Invoice).status === 'partial' ? 'جزئية' : 'غير مدفوعة'}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500">{formatDate(item.date, true)}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm">فاتورة آجلة • {(item.data as Invoice).itemsCount} مادة</p>
                            {(item.data as Invoice).notes && <p className="text-xs text-gray-500 mt-1">{(item.data as Invoice).notes}</p>}
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-amber-600">{formatCurrency((item.data as Invoice).total, settings?.currency)}</p>
                            {(item.data as Invoice).remaining > 0 && <p className="text-xs text-red-600">متبقي: {formatCurrency((item.data as Invoice).remaining, settings?.currency)}</p>}
                          </div>
                        </div>
                        <Link to={`/invoices/${(item.data as Invoice).id}`} className="inline-block mt-2 text-xs text-primary-600 hover:underline">عرض تفاصيل الفاتورة ←</Link>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <p className="font-bold">{(item.data as Payment).receiptNumber}</p>
                            <Badge variant="success" className="text-[10px]">تسديد</Badge>
                          </div>
                          <p className="text-sm text-gray-500">{formatDate(item.date, true)}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm">تسديد دين • {(item.data as Payment).method === 'cash' ? 'نقدي' : (item.data as Payment).method === 'transfer' ? 'تحويل' : 'أخرى'}</p>
                            {(item.data as Payment).notes && <p className="text-xs text-gray-500 mt-1">{(item.data as Payment).notes}</p>}
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-green-600">{formatCurrency((item.data as Payment).amount, settings?.currency)}</p>
                            {(item.data as Payment).remainingAfter !== undefined && <p className="text-xs text-gray-500">متبقي بعده: {formatCurrency((item.data as Payment).remainingAfter!, settings?.currency)}</p>}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500">لا يوجد سجل لهذا الفلتر</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />تفاصيل الفواتير الآجلة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {invoices.map(inv => (
                <div key={inv.id} className="flex justify-between items-center p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm">
                  <div>
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <p className="text-xs text-gray-500">{formatDate(inv.date)} • {inv.itemsCount} مادة</p>
                  </div>
                  <p className="font-bold">{formatCurrency(inv.total, settings?.currency)}</p>
                </div>
              ))}
              {invoices.length === 0 && <p className="text-center text-sm text-gray-500 py-6">لا توجد فواتير آجلة</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" />تفاصيل التسديدات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {payments.map(p => (
                <div key={p.id} className="flex justify-between items-center p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm border border-green-200 dark:border-green-800/30">
                  <div>
                    <p className="font-medium">{p.receiptNumber}</p>
                    <p className="text-xs text-gray-500">{formatDate(p.date)} • {p.method}</p>
                  </div>
                  <p className="font-bold text-green-600">{formatCurrency(p.amount, settings?.currency)}</p>
                </div>
              ))}
              {payments.length === 0 && <p className="text-center text-sm text-gray-500 py-6">لا توجد تسديدات</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
