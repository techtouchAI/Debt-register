import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Search, Edit, Trash2, Printer, Download, Eye, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings } from '@/lib/db';
import { deleteInvoice, getInvoiceWithItems } from '@/lib/invoices';
import { printInvoice } from '@/lib/print';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate, isSameLocalDay } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { OfficeSettings } from '@/types';
import { generateInvoicePDF } from '@/lib/pdf';

export function Invoices() {
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'cash' | 'credit'>('all');
  const [dateFilter, setDateFilter] = useState('');

  const invoices = useLiveQuery(async () => {
    let all = await db.invoices.orderBy('date').reverse().toArray();
    
    if (search) {
      all = all.filter(inv => 
        inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerName.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    if (filterType !== 'all') {
      all = all.filter(inv => inv.type === filterType);
    }
    
    if (dateFilter) {
      all = all.filter(inv => isSameLocalDay(inv.date, dateFilter));
    }
    
    return all;
  }, [search, filterType, dateFilter]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const s = await getSettings();
    setSettings(s || null);
  };

  const [busyId, setBusyId] = useState<number | null>(null);

  const handleDelete = async (invoiceId: number) => {
    if (busyId !== null) return;
    if (!confirm('هل أنت متأكد من حذف هذه الفاتورة؟\nسيتم إرجاع الكميات للمخزن وتحديث رصيد الزبون.')) return;

    setBusyId(invoiceId);
    try {
      const result = await deleteInvoice(invoiceId);
      if (!result.ok) {
        toast.error('تعذّر الحذف', result.error);
        return;
      }
      toast.success('تم حذف الفاتورة', 'أُعيدت الكميات إلى المخزن');
    } catch (error) {
      reportError('Invoices.delete', error, 'حدث خطأ أثناء الحذف');
    } finally {
      setBusyId(null);
    }
  };

  const handlePrint = async (invoiceId: number) => {
    try {
      const found = await getInvoiceWithItems(invoiceId);
      const s = await getSettings();
      if (!found || !s) {
        toast.error('تعذّر الطباعة', 'الفاتورة أو الإعدادات غير متوفرة');
        return;
      }
      const opened = printInvoice(found.invoice, found.items, s);
      if (!opened) {
        toast.warning('المتصفح منع النافذة', 'اسمح بالنوافذ المنبثقة لهذا التطبيق ثم أعد المحاولة');
      }
    } catch (error) {
      reportError('Invoices.print', error, 'تعذّر طباعة الفاتورة');
    }
  };

  const handleExportPDF = async (invoiceId: number) => {
    try {
      const found = await getInvoiceWithItems(invoiceId);
      const s = await getSettings();
      if (!found || !s) {
        toast.error('تعذّر التصدير', 'الفاتورة أو الإعدادات غير متوفرة');
        return;
      }
      const customer = found.invoice.customerId ? await db.customers.get(found.invoice.customerId) : undefined;
      await generateInvoicePDF(found.invoice, found.items, s, customer);
    } catch (error) {
      reportError('Invoices.export', error, 'تعذّر تصدير الفاتورة');
    }
  };

  const totalSales = invoices?.reduce((sum, inv) => sum + inv.total, 0) || 0;
  const cashSales = invoices?.filter(inv => inv.type === 'cash').reduce((sum, inv) => sum + inv.total, 0) || 0;
  const creditSales = invoices?.filter(inv => inv.type === 'credit').reduce((sum, inv) => sum + inv.total, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary-600" />
            الفواتير والمبيعات
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">سجل المبيعات اليومي - قلب النظام</p>
        </div>
        <Link to="/invoices/new">
          <Button className="bg-primary-600 hover:bg-primary-700">
            <Plus className="w-4 h-4 ml-2" />
            فاتورة بيع جديدة
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي المبيعات</p>
            <p className="text-lg font-bold">{formatCurrency(totalSales, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">{invoices?.length || 0} فاتورة</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">مبيعات نقدية</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(cashSales, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">{invoices?.filter(i => i.type === 'cash').length || 0} فاتورة</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">مبيعات آجلة</p>
            <p className="text-lg font-bold text-amber-600">{formatCurrency(creditSales, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">{invoices?.filter(i => i.type === 'credit').length || 0} فاتورة</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">متوسط الفاتورة</p>
            <p className="text-lg font-bold">{formatCurrency(invoices?.length ? totalSales / invoices.length : 0, settings?.currency)}</p>
            <p className="text-[11px] text-gray-500">لكل عملية</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="بحث برقم الفاتورة أو اسم الزبون..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="pr-8" />
              </div>
              <Button variant={filterType === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilterType('all')}>الكل</Button>
              <Button variant={filterType === 'cash' ? 'default' : 'outline'} size="sm" onClick={() => setFilterType('cash')} className={filterType === 'cash' ? 'bg-green-600' : ''}>نقدي</Button>
              <Button variant={filterType === 'credit' ? 'default' : 'outline'} size="sm" onClick={() => setFilterType('credit')} className={filterType === 'credit' ? 'bg-amber-600' : ''}>آجل</Button>
              {(search || dateFilter || filterType !== 'all') && (
                <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDateFilter(''); setFilterType('all'); }}>مسح</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {invoices?.map((invoice) => (
          <Card key={invoice.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${invoice.type === 'cash' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'}`}>
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900 dark:text-white">{invoice.invoiceNumber}</p>
                      <Badge variant={invoice.type === 'cash' ? 'success' : 'warning'} className="text-[10px]">
                        {invoice.type === 'cash' ? 'نقدي' : 'آجل'}
                      </Badge>
                      <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                        {invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'جزئية' : 'غير مدفوعة'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{invoice.customerName} • {formatDate(invoice.date, true)} • {invoice.itemsCount} مادة</p>
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-3">
                  <div className="text-right">
                    <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(invoice.total, settings?.currency)}</p>
                    {invoice.discount > 0 && <p className="text-xs text-gray-500">خصم: {formatCurrency(invoice.discount, settings?.currency)}</p>}
                    {invoice.type === 'credit' && invoice.remaining > 0 && <p className="text-xs text-red-600">متبقي: {formatCurrency(invoice.remaining, settings?.currency)}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Link to={`/invoices/${invoice.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="w-4 h-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePrint(invoice.id!)}><Printer className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleExportPDF(invoice.id!)}><Download className="w-4 h-4" /></Button>
                    <Link to={`/invoices/${invoice.id}/edit`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="w-4 h-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" disabled={busyId === invoice.id} onClick={() => handleDelete(invoice.id!)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {invoices?.length === 0 && (
        <Card className="border-0 shadow-md">
          <CardContent className="text-center py-16">
            <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="font-bold mb-2">لا توجد فواتير</h3>
            <p className="text-sm text-gray-500 mb-4">ابدأ بإنشاء فاتورة بيع جديدة</p>
            <Link to="/invoices/new"><Button><Plus className="w-4 h-4 ml-2" />فاتورة جديدة</Button></Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
