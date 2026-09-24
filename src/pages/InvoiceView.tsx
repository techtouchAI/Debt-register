import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGoBack, useReturnTo } from '@/hooks/useGoBack';
import { ArrowRight, FileText, Printer, Download, Eye, Edit, Trash2, User, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, getSettingsOrDefault } from '@/lib/db';
import { deleteInvoice, getInvoiceWithItems } from '@/lib/invoices';
import { buildInvoicePrintHtml, printInvoice } from '@/lib/print';
import { generateInvoicePDF } from '@/lib/pdf';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { formatCurrency, formatDate, roundMoney, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { confirmDialog } from '@/lib/confirm';
import { formatDocumentNumber, saleTypeLabel } from '@/lib/labels';
import { usePermission } from '@/hooks/useSession';
import type { Customer, Invoice, InvoiceItem, OfficeSettings } from '@/types';

/**
 * صفحة عرض الفاتورة.
 *
 * سابقاً كان زر العين يفتح نموذج التعديل نفسه (المسار /invoices/:id كان
 * يُفسَّر كتعديل) فلا توجد معاينة حقيقية. هذه الصفحة للعرض فقط مع
 * معاينة وطباعة وحفظ كمستند وتعديل وحذف (التعديل والحذف للمدير فقط).
 */

export function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const returnTo = useReturnTo();
  const can = usePermission();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customer, setCustomer] = useState<Customer | undefined>(undefined);
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const invoiceId = Number(id);
      if (!Number.isFinite(invoiceId)) {
        navigate('/invoices', { replace: true });
        return;
      }
      try {
        const [found, s] = await Promise.all([getInvoiceWithItems(invoiceId), getSettingsOrDefault()]);
        if (cancelled) return;
        if (!found) {
          toast.error('الفاتورة غير موجودة', 'ربما تم حذفها');
          navigate('/invoices', { replace: true });
          return;
        }
        setInvoice(found.invoice);
        setItems(found.items);
        setSettings(s);
        if (found.invoice.customerId) {
          const c = await db.customers.get(found.invoice.customerId);
          if (!cancelled) setCustomer(c);
        }
      } catch (error) {
        if (!cancelled) {
          reportError('InvoiceView.load', error, 'تعذّر تحميل الفاتورة');
          navigate('/invoices', { replace: true });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const handlePrint = useCallback(async () => {
    if (!invoice || !settings || isBusy) return;
    setIsBusy(true);
    try {
      const printed = await printInvoice(invoice, items, settings);
      if (!printed) setShowPreview(true); // البديل: معاينة مع زر حفظ المستند
    } catch (error) {
      reportError('InvoiceView.print', error, 'تعذّر الطباعة');
    } finally {
      setIsBusy(false);
    }
  }, [invoice, items, settings, isBusy]);

  const handleExportPdf = useCallback(async () => {
    if (!invoice || !settings || isBusy) return;
    setIsBusy(true);
    try {
      const saved = await generateInvoicePDF(invoice, items, settings, customer);
      if (saved) toast.success('تم حفظ الفاتورة كمستند', saved.message);
    } catch (error) {
      reportError('InvoiceView.pdf', error, 'تعذّر حفظ المستند');
    } finally {
      setIsBusy(false);
    }
  }, [invoice, items, settings, customer, isBusy]);

  const handleDelete = useCallback(async () => {
    if (!invoice?.id || isBusy) return;
    const confirmed = await confirmDialog({
      title: `حذف الفاتورة ${formatDocumentNumber(invoice.invoiceNumber)}؟`,
      message: 'سيتم إرجاع الكميات للمخزن وتحديث رصيد الزبون.',
      confirmText: 'حذف الفاتورة',
      tone: 'danger'
    });
    if (!confirmed) return;
    setIsBusy(true);
    try {
      const result = await deleteInvoice(invoice.id);
      if (!result.ok) {
        toast.error('تعذّر الحذف', result.error);
        return;
      }
      toast.success('تم حذف الفاتورة', 'أُعيدت الكميات إلى المخزن');
      // السجل المحذوف لا يبقى في السجل: نرجع للقائمة إن جئنا منها، وإلا نستبدله
      returnTo('/invoices');
    } catch (error) {
      reportError('InvoiceView.delete', error, 'حدث خطأ أثناء الحذف');
    } finally {
      setIsBusy(false);
    }
  }, [invoice, isBusy, returnTo]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm text-gray-500">جاري تحميل الفاتورة…</p>
      </div>
    );
  }

  if (!invoice || !settings) return null;

  // الدين القديم المحمول على الفاتورة (لقطة وقت الإصدار) + المطلوب كاملاً
  const previousBalance = Math.max(0, roundMoney(toFiniteNumber(invoice.previousBalance)));
  const totalDue = roundMoney(invoice.total + previousBalance);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => goBack('/invoices')} aria-label="رجوع للفواتير">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
              <FileText className="w-6 h-6 text-primary-600" />
              {formatDocumentNumber(invoice.invoiceNumber)}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
              {formatDate(invoice.date, true)} • {invoice.itemsCount} مادة
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={invoice.type === 'cash' ? 'success' : 'warning'}>{saleTypeLabel(invoice.type)}</Badge>
          <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'partial' ? 'warning' : 'destructive'}>
            {invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'جزئية' : 'غير مدفوعة'}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setShowPreview(true)} className="bg-primary-600 hover:bg-primary-700 flex-1 sm:flex-none">
          <Eye className="w-4 h-4 ml-2" />
          معاينة
        </Button>
        <Button variant="outline" onClick={handlePrint} disabled={isBusy} className="flex-1 sm:flex-none">
          <Printer className="w-4 h-4 ml-2" />
          طباعة
        </Button>
        <Button variant="outline" onClick={handleExportPdf} disabled={isBusy} className="flex-1 sm:flex-none">
          <Download className="w-4 h-4 ml-2" />
          حفظ كمستند
        </Button>
        {can('invoices.edit') && (
          <Link to={`/invoices/${invoice.id}/edit`} className="flex-1 sm:flex-none">
            <Button variant="outline" className="w-full">
              <Edit className="w-4 h-4 ml-2" />
              تعديل
            </Button>
          </Link>
        )}
        {can('invoices.delete') && (
          <Button variant="destructive" onClick={handleDelete} disabled={isBusy} className="flex-1 sm:flex-none">
            <Trash2 className="w-4 h-4 ml-2" />
            حذف
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">مواد الفاتورة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 text-[12px] text-gray-600 dark:text-gray-300">
                    <th className="p-3 text-right font-bold">المادة</th>
                    <th className="p-3 text-center font-bold whitespace-nowrap">الكمية</th>
                    <th className="p-3 text-center font-bold whitespace-nowrap">السعر</th>
                    <th className="p-3 text-left font-bold whitespace-nowrap">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="p-3 font-medium">{item.materialName}</td>
                      <td className="p-3 text-center whitespace-nowrap">{item.quantity}</td>
                      <td className="p-3 text-center whitespace-nowrap">{formatCurrency(item.unitPrice, settings.currency)}</td>
                      <td className="p-3 text-left font-bold text-green-600 whitespace-nowrap">{formatCurrency(item.total, settings.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invoice.notes && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm">
                <span className="font-bold">ملاحظات: </span>
                {invoice.notes}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                الزبون
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="font-bold">{invoice.customerName}</p>
              {customer?.phone && <p className="text-gray-500">{customer.phone}</p>}
              {customer?.address && <p className="text-gray-500">{customer.address}</p>}
              {customer?.id && (
                <Link to={`/customers/${customer.id}`} className="inline-block mt-2 text-primary-600 hover:underline text-xs">
                  عرض كشف الحساب ←
                </Link>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base">الملخص المالي</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">المجموع:</span><span className="font-bold">{formatCurrency(invoice.subtotal, settings.currency)}</span></div>
              {invoice.discount > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">الخصم:</span><span className="font-bold">{formatCurrency(invoice.discount, settings.currency)}</span></div>
              )}
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <div className="flex justify-between text-base"><span className="font-bold">الإجمالي:</span><span className="font-bold text-primary-600">{formatCurrency(invoice.total, settings.currency)}</span></div>
              {previousBalance > 0 && (
                <>
                  <div className="flex justify-between" data-testid="invoice-view-previous-balance">
                    <span className="text-gray-500">الرصيد السابق:</span>
                    <span className="font-bold text-amber-600">{formatCurrency(previousBalance, settings.currency)}</span>
                  </div>
                  <div className="flex justify-between text-base"><span className="font-bold">إجمالي المطلوب:</span><span className="font-bold text-primary-600">{formatCurrency(totalDue, settings.currency)}</span></div>
                  <p className="text-[11px] leading-relaxed text-gray-500">
                    الرصيد السابق دين قديم كان على الزبون قبل هذه الفاتورة، ويُسدَّد معها في نفس الوصل.
                  </p>
                </>
              )}
              {invoice.type === 'credit' && (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">المدفوع:</span><span className="font-bold text-green-600">{formatCurrency(invoice.paidAmount, settings.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">المتبقي على هذه الفاتورة:</span><span className={`font-bold ${invoice.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(invoice.remaining, settings.currency)}</span></div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <DocumentPreviewDialog
        open={showPreview}
        title={`فاتورة ${formatDocumentNumber(invoice.invoiceNumber)}`}
        bodyHtml={buildInvoicePrintHtml(invoice, items, settings)}
        fileNameBase={`فاتورة_${formatDocumentNumber(invoice.invoiceNumber)}_${invoice.customerName}`}
        shareTitle={`فاتورة ${formatDocumentNumber(invoice.invoiceNumber)}`}
        onClose={() => setShowPreview(false)}
      />
    </div>
  );
}
