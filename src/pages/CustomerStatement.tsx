import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import { ArrowRight, FileText, CreditCard, Printer, Download, Calendar, Phone, MapPin, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, getSettings } from '@/lib/db';
import { getCustomerBalance } from '@/lib/debts';
import { formatCurrency, formatDate, roundMoney, toFiniteNumber } from '@/lib/utils';
import { reportError } from '@/lib/errors';
import { printDocument, statementDocument } from '@/lib/print';
import { openDocumentPreview } from '@/lib/documentPreview';
import { Invoice, Payment } from '@/types';
import { saveDocumentPdf } from '@/lib/pdf';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from '@/lib/toast';
import { formatDocumentNumber, paymentMethodLabel, saleTypeLabel } from '@/lib/labels';
import { usePermission } from '@/hooks/useSession';

export function CustomerStatement() {
  const { id } = useParams();
  const goBack = useGoBack();
  const can = usePermission();
  const [filter, setFilter] = useState<'all' | 'invoices' | 'payments'>('all');

  const statement = useLiveQuery(async () => {
    const customerId = Number(id);
    if (!Number.isInteger(customerId) || customerId <= 0) return null;
    const [customer, settings, invoices, payments, balance] = await Promise.all([
      db.customers.get(customerId),
      getSettings(),
      db.invoices.where('customerId').equals(customerId).sortBy('date'),
      db.payments.where('customerId').equals(customerId).sortBy('date'),
      getCustomerBalance(customerId)
    ]);
    if (!customer) return null;
    return { customer, settings: settings ?? null, invoices: invoices.reverse(), payments: payments.reverse(), debt: balance.debt };
  }, [id]);

  const customer = statement?.customer ?? null;
  const settings = statement?.settings ?? null;
  const invoices = statement?.invoices ?? [];
  const payments = statement?.payments ?? [];
  const debt = statement?.debt ?? 0;

  /** وصف الكشف: يُبنى مرة ويُستخدم في المعاينة والطباعة والحفظ */
  const currentStatementDocument = () =>
    customer && settings ? statementDocument(customer, invoices, payments, settings, debt) : null;

  const handlePrint = async () => {
    const document = currentStatementDocument();
    if (!document) return;
    // طباعة النظام، أو معاينة الكشف مع بديل الحفظ إن لم يتوفر حوار طباعة
    await printDocument(document);
  };

  const handleExportPDF = async () => {
    if (!customer || !settings) return;
    try {
      const document = currentStatementDocument();
      if (!document) return;
      const saved = await saveDocumentPdf(document);
      if (saved) toast.success('تم حفظ كشف الحساب كمستند', saved.message);
    } catch (error) {
      reportError('CustomerStatement.pdf', error, 'تعذّر حفظ كشف الحساب كمستند');
    }
  };

  const totalInvoices = roundMoney(invoices.reduce((sum, inv) => sum + toFiniteNumber(inv.total), 0));
  const totalPaid = roundMoney(payments.reduce((sum, p) => sum + toFiniteNumber(p.amount), 0));

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
        <Button className="mt-4" onClick={() => goBack('/customers')}>رجوع للعملاء</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        {/* رجوع حقيقي (لا رابط يدفع مدخلاً جديداً)؛ السهم لليمين في الواجهة العربية */}
        <Button variant="ghost" size="icon" onClick={() => goBack('/customers')} aria-label="رجوع للعملاء">
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">كشف حساب الزبون</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">سجل زمني تفصيلي لجميع مسحوبات ومدفوعات الزبون</p>
        </div>
      </div>

      {/* Customer Card */}
      <Card className="border-0 shadow-md overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-primary-600 to-primary-400" />
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-2xl">
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
            <div className="flex flex-wrap gap-2">
              <Button className="bg-primary-600 hover:bg-primary-700" onClick={() => { const document = currentStatementDocument(); if (document) openDocumentPreview(document); }}><Eye className="w-4 h-4 ml-2" />معاينة</Button>
              <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 ml-2" />طباعة</Button>
              <Button variant="outline" onClick={handleExportPDF}><Download className="w-4 h-4 ml-2" />حفظ كمستند</Button>
              {can('sales.create') && <Link to={`/invoices/new?customerId=${customer.id}`}><Button className="bg-primary-600 hover:bg-primary-700">فاتورة جديدة</Button></Link>}
              {can('payments.create') && <Link to={`/payments/new?customerId=${customer.id}`}><Button className="bg-green-600 hover:bg-green-700">تسديد دين</Button></Link>}
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
          <div className="flex flex-wrap gap-2">
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
          <div className="space-y-4" data-testid="statement-timeline">
            {filteredTimeline.length ? filteredTimeline.map((item, idx) => {
              const entryInvoice = item.type === 'invoice' ? (item.data as Invoice) : null;
              const entryPayment = item.type === 'payment' ? (item.data as Payment) : null;
              const carried = entryInvoice ? Math.max(0, roundMoney(toFiniteNumber(entryInvoice.previousBalance))) : 0;
              return (
              <div key={idx} className="relative flex gap-3 sm:gap-4" data-testid="statement-timeline-item">
                <div className="flex shrink-0 flex-col items-center">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full sm:h-10 sm:w-10 ${item.type === 'invoice' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'}`}>
                    {item.type === 'invoice' ? <FileText className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                  </div>
                  {idx !== filteredTimeline.length - 1 && <div className="mt-2 w-px flex-1 bg-gray-200 dark:bg-gray-700" />}
                </div>

                {/* min-w-0 ضروري: بدونه يمنع عرض المحتوى الأدنى العمود من الانضغاط
                    فتخرج البطاقة عن حدود الحاوية على شاشات الهاتف الضيقة. */}
                <div className="min-w-0 flex-1 pb-6">
                  <div className={`rounded-xl border p-3 sm:p-4 ${item.type === 'invoice' ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' : 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30'}`}>
                    {/* الرأس يلتف سطراً عند الحاجة: الرقم والباقة في جهة، والتاريخ في جهة أخرى */}
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 font-bold [overflow-wrap:anywhere]">
                          {entryInvoice ? formatDocumentNumber(entryInvoice.invoiceNumber) : entryPayment ? formatDocumentNumber(entryPayment.receiptNumber) : ''}
                        </p>
                        {entryInvoice ? (
                          <Badge variant={entryInvoice.status === 'paid' ? 'success' : entryInvoice.status === 'partial' ? 'warning' : 'destructive'} className="shrink-0 text-[10px]">
                            {entryInvoice.status === 'paid' ? 'مدفوعة' : entryInvoice.status === 'partial' ? 'جزئية' : 'غير مدفوعة'}
                          </Badge>
                        ) : (
                          <Badge variant="success" className="shrink-0 text-[10px]">تسديد</Badge>
                        )}
                      </div>
                      <p className="shrink-0 whitespace-nowrap text-xs text-gray-500 sm:text-sm">{formatDate(item.date, true)}</p>
                    </div>

                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 basis-40">
                        {entryInvoice ? (
                          <>
                            <p className="break-words text-sm">فاتورة {saleTypeLabel(entryInvoice.type)} • {entryInvoice.itemsCount} مادة</p>
                            {entryInvoice.notes && <p className="mt-1 break-words text-xs text-gray-500 [overflow-wrap:anywhere]">{entryInvoice.notes}</p>}
                          </>
                        ) : entryPayment ? (
                          <>
                            <p className="break-words text-sm">تسديد دين • {paymentMethodLabel(entryPayment.method)}</p>
                            {entryPayment.notes && <p className="mt-1 break-words text-xs text-gray-500 [overflow-wrap:anywhere]">{entryPayment.notes}</p>}
                          </>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-left">
                        {entryInvoice ? (
                          <>
                            <p className="whitespace-nowrap font-bold text-amber-600">{formatCurrency(entryInvoice.total, settings?.currency)}</p>
                            {carried > 0 && (
                              <p className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-400">
                                منها رصيد سابق: {formatCurrency(carried, settings?.currency)}
                              </p>
                            )}
                            {entryInvoice.remaining > 0 && <p className="whitespace-nowrap text-xs text-red-600">متبقي: {formatCurrency(entryInvoice.remaining, settings?.currency)}</p>}
                          </>
                        ) : entryPayment ? (
                          <>
                            <p className="whitespace-nowrap font-bold text-green-600">{formatCurrency(entryPayment.amount, settings?.currency)}</p>
                            {entryPayment.remainingAfter !== undefined && (
                              <p className="whitespace-nowrap text-xs text-gray-500">متبقي بعده: {formatCurrency(entryPayment.remainingAfter, settings?.currency)}</p>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>

                    {entryInvoice && (
                      <Link to={`/invoices/${entryInvoice.id}`} className="mt-2 inline-block text-xs text-primary-600 hover:underline">عرض تفاصيل الفاتورة ←</Link>
                    )}
                  </div>
                </div>
              </div>
              );
            }) : (
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
                <div key={inv.id} className="flex items-center justify-between gap-2 p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words [overflow-wrap:anywhere]">{formatDocumentNumber(inv.invoiceNumber)}</p>
                    <p className="text-xs text-gray-500">{formatDate(inv.date)} • {inv.itemsCount} مادة</p>
                  </div>
                  <p className="shrink-0 font-bold whitespace-nowrap">{formatCurrency(inv.total, settings?.currency)}</p>
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
                <div key={p.id} className="flex items-center justify-between gap-2 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm border border-green-200 dark:border-green-800/30">
                  <div className="min-w-0">
                    <p className="font-medium break-words [overflow-wrap:anywhere]">{formatDocumentNumber(p.receiptNumber)}</p>
                    <p className="text-xs text-gray-500">{formatDate(p.date)} • {paymentMethodLabel(p.method)}</p>
                  </div>
                  <p className="shrink-0 font-bold text-green-600 whitespace-nowrap">{formatCurrency(p.amount, settings?.currency)}</p>
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
