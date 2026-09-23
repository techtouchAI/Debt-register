import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGoBack, useReturnTo } from '@/hooks/useGoBack';
import { ArrowRight, ClipboardList, Download, Edit, Eye, Loader2, Printer, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSettingsOrDefault } from '@/lib/db';
import { deletePurchase, getPurchaseWithItems } from '@/lib/purchases';
import { buildPurchasePrintHtml, printPurchase } from '@/lib/print';
import { generatePurchasePDF } from '@/lib/pdf';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { reportError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import type { OfficeSettings, Purchase, PurchaseItem } from '@/types';

export function PurchaseView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const returnTo = useReturnTo();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const purchaseId = Number(id);
        if (!Number.isFinite(purchaseId)) {
          navigate('/purchases', { replace: true });
          return;
        }
        const [found, s] = await Promise.all([getPurchaseWithItems(purchaseId), getSettingsOrDefault()]);
        if (cancelled) return;
        if (!found) {
          toast.error('وصل الشراء غير موجود');
          navigate('/purchases', { replace: true });
          return;
        }
        setPurchase(found.purchase);
        setItems(found.items);
        setSettings(s);
      } catch (error) {
        if (!cancelled) {
          reportError('PurchaseView.load', error, 'تعذّر تحميل وصل الشراء');
          navigate('/purchases', { replace: true });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const handlePrint = useCallback(async () => {
    if (!purchase || !settings || isBusy) return;
    setIsBusy(true);
    try {
      const printed = await printPurchase(purchase, items, settings);
      if (!printed) setShowPreview(true);
    } catch (error) {
      reportError('PurchaseView.print', error, 'تعذّرت طباعة وصل الشراء');
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, items, purchase, settings]);

  const handlePdf = useCallback(async () => {
    if (!purchase || !settings || isBusy) return;
    setIsBusy(true);
    try {
      const fileName = await generatePurchasePDF(purchase, items, settings);
      toast.success('تم إنشاء ملف PDF', fileName);
    } catch (error) {
      reportError('PurchaseView.pdf', error, 'تعذّر إنشاء ملف PDF');
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, items, purchase, settings]);

  const handleDelete = useCallback(async () => {
    if (!purchase?.id || isBusy) return;
    if (!confirm(`هل أنت متأكد من حذف وصل الشراء ${purchase.purchaseNumber}؟ ستُخصم كمياته من المخزن.`)) return;
    setIsBusy(true);
    try {
      const result = await deletePurchase(purchase.id);
      if (!result.ok) {
        toast.warning('تعذّر حذف الوصل', result.error);
        return;
      }
      toast.success('تم حذف وصل الشراء', 'تم تحديث المخزن');
      // السجل المحذوف لا يبقى في السجل: نرجع للقائمة إن جئنا منها، وإلا نستبدله
      returnTo('/purchases');
    } catch (error) {
      reportError('PurchaseView.delete', error, 'تعذّر حذف وصل الشراء');
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, purchase, returnTo]);

  if (isLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;
  if (!purchase || !settings) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => goBack('/purchases')} aria-label="رجوع لوصول الشراء"><ArrowRight className="w-5 h-5" /></Button><div><h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2"><ClipboardList className="w-6 h-6 text-primary-600" />{purchase.purchaseNumber}</h1><p className="text-xs sm:text-sm text-gray-500 mt-1">{formatDate(purchase.date, true)} • {purchase.itemsCount} مادة</p></div></div>
        <Badge variant={purchase.paymentMethod === 'cash' ? 'success' : 'warning'}>{purchase.paymentMethod === 'cash' ? 'مدفوع نقداً' : 'آجل للمورد'}</Badge>
      </div>

      <div className="flex flex-wrap gap-2"><Button onClick={() => setShowPreview(true)} className="bg-primary-600 hover:bg-primary-700 flex-1 sm:flex-none"><Eye className="w-4 h-4 ml-2" />معاينة</Button><Button variant="outline" onClick={handlePrint} disabled={isBusy} className="flex-1 sm:flex-none"><Printer className="w-4 h-4 ml-2" />طباعة</Button><Button variant="outline" onClick={handlePdf} disabled={isBusy} className="flex-1 sm:flex-none"><Download className="w-4 h-4 ml-2" />PDF</Button><Link to={`/purchases/${purchase.id}/edit`} className="flex-1 sm:flex-none"><Button variant="outline" className="w-full"><Edit className="w-4 h-4 ml-2" />تعديل</Button></Link><Button variant="destructive" onClick={handleDelete} disabled={isBusy} className="flex-1 sm:flex-none"><Trash2 className="w-4 h-4 ml-2" />حذف</Button></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-md lg:col-span-2"><CardHeader><CardTitle className="text-base">مواد الوصل</CardTitle></CardHeader><CardContent><div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-x-auto"><table className="w-full text-sm min-w-[480px]"><thead><tr className="bg-gray-50 dark:bg-gray-800/60 text-[12px] text-gray-600 dark:text-gray-300"><th className="p-3 text-right">المادة</th><th className="p-3 text-center whitespace-nowrap">الكمية</th><th className="p-3 text-center whitespace-nowrap">سعر الشراء</th><th className="p-3 text-left whitespace-nowrap">الإجمالي</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-gray-100 dark:border-gray-800"><td className="p-3 font-medium">{item.materialName}</td><td className="p-3 text-center whitespace-nowrap">{item.quantity}</td><td className="p-3 text-center whitespace-nowrap">{formatCurrency(item.purchasePrice, settings.currency)}</td><td className="p-3 text-left font-bold text-green-600 whitespace-nowrap">{formatCurrency(item.total, settings.currency)}</td></tr>)}</tbody></table></div>{purchase.notes && <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm"><strong>ملاحظات: </strong>{purchase.notes}</div>}</CardContent></Card>
        <Card className="border-0 shadow-md"><CardHeader><CardTitle className="text-base">ملخص الشراء</CardTitle></CardHeader><CardContent className="text-sm space-y-2"><div className="flex justify-between"><span className="text-gray-500">المورد:</span><strong>{purchase.supplierName}</strong></div><div className="flex justify-between"><span className="text-gray-500">المجموع:</span><strong>{formatCurrency(purchase.subtotal, settings.currency)}</strong></div>{purchase.discount > 0 && <div className="flex justify-between"><span className="text-gray-500">الخصم:</span><strong>{formatCurrency(purchase.discount, settings.currency)}</strong></div>}<div className="h-px bg-gray-200 dark:bg-gray-700" /><div className="flex justify-between text-base"><strong>الإجمالي:</strong><strong className="text-primary-600">{formatCurrency(purchase.total, settings.currency)}</strong></div>{purchase.paymentMethod === 'credit' && <><div className="flex justify-between"><span className="text-gray-500">المدفوع:</span><strong className="text-green-600">{formatCurrency(purchase.paidAmount, settings.currency)}</strong></div><div className="flex justify-between"><span className="text-gray-500">المتبقي:</span><strong className="text-red-600">{formatCurrency(purchase.remaining, settings.currency)}</strong></div></>}</CardContent></Card>
      </div>

      <DocumentPreviewDialog open={showPreview} title={purchase.purchaseNumber} bodyHtml={buildPurchasePrintHtml(purchase, items, settings)} fileNameBase={`${purchase.purchaseNumber}_${purchase.supplierName}`} shareTitle={`وصل شراء ${purchase.purchaseNumber}`} onClose={() => setShowPreview(false)} />
    </div>
  );
}
