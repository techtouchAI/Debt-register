import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Search, Edit, Trash2, Printer, Download, Eye, Calendar, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, logActivity } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate } from '@/lib/utils';
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
      all = all.filter(inv => inv.date.startsWith(dateFilter));
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

  const handleDelete = async (invoiceId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الفاتورة؟\nسيتم إرجاع الكميات للمخزن.')) return;

    try {
      const invoice = await db.invoices.get(invoiceId);
      const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();

      // Restore stock
      for (const item of items) {
        const material = await db.materials.get(item.materialId);
        if (material) {
          await db.materials.update(material.id!, { quantity: material.quantity + item.quantity });
        }
      }

      await db.transaction('rw', db.invoices, db.invoiceItems, async () => {
        await db.invoiceItems.where('invoiceId').equals(invoiceId).delete();
        await db.invoices.delete(invoiceId);
      });

      await logActivity('حذف فاتورة', `تم حذف الفاتورة: ${invoice?.invoiceNumber}`, 'invoice', invoiceId);
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء الحذف');
    }
  };

  const handlePrint = async (invoiceId: number) => {
    const invoice = await db.invoices.get(invoiceId);
    const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
    const s = await getSettings();
    if (!invoice || !s) return;

    // Create printable HTML
    const printContent = document.createElement('div');
    printContent.innerHTML = `
      <div style="font-family: 'Cairo', sans-serif; direction: rtl; padding: 20px; max-width: 800px; margin: 0 auto;">
        <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 15px; margin-bottom: 20px;">
          <h1 style="color: #16a34a; margin: 0; font-size: 24px;">${s.officeName}</h1>
          <p style="margin: 5px 0; color: #666;">${s.address || ''} | ${s.phone || ''}</p>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <p><strong>رقم الفاتورة:</strong> ${invoice.invoiceNumber}</p>
            <p><strong>الزبون:</strong> ${invoice.customerName}</p>
            <p><strong>النوع:</strong> ${invoice.type === 'cash' ? 'نقدي' : 'آجل'}</p>
          </div>
          <div style="text-align: left;">
            <p><strong>التاريخ:</strong> ${formatDate(invoice.date, true)}</p>
            <p><strong>الحالة:</strong> ${invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'}</p>
          </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: #f0fdf4;">
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">#</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">المادة</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: center;">الكمية</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: center;">السعر</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${idx + 1}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.materialName}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.quantity}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.unitPrice.toLocaleString()}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: left;">${item.total.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="text-align: left; border-top: 2px solid #16a34a; padding-top: 15px;">
          <p style="font-size: 14px;">المجموع: ${invoice.subtotal.toLocaleString()} ${s.currency}</p>
          ${invoice.discount > 0 ? `<p>الخصم: ${invoice.discount.toLocaleString()} ${s.currency}</p>` : ''}
          <p style="font-size: 18px; font-weight: bold; color: #16a34a;">الإجمالي: ${invoice.total.toLocaleString()} ${s.currency}</p>
          ${invoice.type === 'credit' ? `<p>المدفوع: ${invoice.paidAmount.toLocaleString()} | المتبقي: ${invoice.remaining.toLocaleString()}</p>` : ''}
        </div>
        ${s.invoiceFooter ? `<div style="text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px dashed #ccc;"><p style="color: #666; font-size: 12px;">${s.invoiceFooter}</p></div>` : ''}
      </div>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html dir="rtl"><head><title>${invoice.invoiceNumber}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
        <style>body{font-family:'Cairo',sans-serif;} @media print{body{-webkit-print-color-adjust:exact;}}</style>
        </head><body>${printContent.innerHTML}</body></html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    }
  };

  const handleExportPDF = async (invoiceId: number) => {
    const invoice = await db.invoices.get(invoiceId);
    const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
    const s = await getSettings();
    const customer = invoice?.customerId ? await db.customers.get(invoice.customerId) : undefined;
    if (!invoice || !s) return;
    await generateInvoicePDF(invoice, items, s, customer);
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" onClick={() => handleDelete(invoice.id!)}><Trash2 className="w-4 h-4" /></Button>
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
