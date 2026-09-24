import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Download, Edit, Eye, FileText, HelpCircle, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db, getSettingsOrDefault } from '@/lib/db';
import { deletePurchase, getPurchaseWithItems } from '@/lib/purchases';
import { generatePurchasePDF } from '@/lib/pdf';
import { printPurchase } from '@/lib/print';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatDate } from '@/lib/utils';
import { reportError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm';
import { documentNumberMatches, formatDocumentNumber, saleTypeLabel } from '@/lib/labels';
import { SalesVsPurchaseHelpDialog } from '@/components/help/SalesVsPurchaseHelpDialog';

export function Purchases() {
  const settings = useLiveQuery(() => getSettingsOrDefault(), []);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const purchases = useLiveQuery(async () => {
    const all = await db.purchases.orderBy('date').reverse().toArray();
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter((purchase) => documentNumberMatches(purchase.purchaseNumber, query) || purchase.supplierName.toLowerCase().includes(query));
  }, [search]);

  const handlePrint = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const found = await getPurchaseWithItems(id);
      const s = settings || await getSettingsOrDefault();
      if (!found) {
        toast.error('وصل الشراء غير موجود');
        return;
      }
      const printed = await printPurchase(found.purchase, found.items, s);
      if (!printed) toast.info('لا يوجد حوار طباعة هنا', 'افتح الوصل ثم استخدم زر "حفظ كمستند"');
    } catch (error) {
      reportError('Purchases.print', error, 'تعذّرت طباعة وصل الشراء');
    } finally {
      setBusyId(null);
    }
  };

  const handlePdf = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const found = await getPurchaseWithItems(id);
      const s = settings || await getSettingsOrDefault();
      if (!found) {
        toast.error('وصل الشراء غير موجود');
        return;
      }
      const saved = await generatePurchasePDF(found.purchase, found.items, s);
      if (saved) toast.success('تم حفظ وصل الشراء كمستند', saved.message);
    } catch (error) {
      reportError('Purchases.pdf', error, 'تعذّر حفظ المستند');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (busyId !== null) return;
    const confirmed = await confirmDialog({
      title: 'حذف وصل الشراء؟',
      message: 'ستُخصم كمياته من المخزن إذا لم تكن قد بيعت.',
      confirmText: 'حذف الوصل',
      tone: 'danger'
    });
    if (!confirmed) return;
    setBusyId(id);
    try {
      const result = await deletePurchase(id);
      if (!result.ok) {
        toast.warning('تعذّر حذف الوصل', result.error);
        return;
      }
      toast.success('تم حذف وصل الشراء', 'تم تحديث كمية المخزن');
    } catch (error) {
      reportError('Purchases.delete', error, 'حدث خطأ أثناء حذف وصل الشراء');
    } finally {
      setBusyId(null);
    }
  };

  const all = purchases || [];
  const total = all.reduce((sum, purchase) => sum + purchase.total, 0);
  const creditTotal = all.filter((purchase) => purchase.paymentMethod === 'credit').reduce((sum, purchase) => sum + purchase.remaining, 0);
  const itemCount = all.reduce((sum, purchase) => sum + purchase.itemsCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ClipboardList className="w-7 h-7 text-primary-600" />وصول الشراء</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            مشترياتك من الموردين: تدخل المواد إلى المخزن وتُسجَّل نقداً أو ديناً للمورد — أما بيع المواد للزبائن فيُسجَّل في الفواتير.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          <Button variant="outline" className="flex-1 lg:flex-none" onClick={() => setShowHelp(true)}>
            <HelpCircle className="w-4 h-4 ml-1" />
            ما الفرق بينه وبين فاتورة البيع؟
          </Button>
          <Link to="/purchases/new" className="flex-1 lg:flex-none"><Button className="bg-primary-600 hover:bg-primary-700 w-full"><Plus className="w-4 h-4 ml-2" />وصل شراء جديد</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">إجمالي المشتريات المعروضة</p><p className="text-lg font-bold">{formatCurrency(total, settings?.currency)}</p><p className="text-[11px] text-gray-500">{all.length} وصل</p></CardContent></Card>
        <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">المتبقي للموردين</p><p className="text-lg font-bold text-red-600">{formatCurrency(creditTotal, settings?.currency)}</p><p className="text-[11px] text-gray-500">من الوصول الآجلة</p></CardContent></Card>
        <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">المواد المدخلة</p><p className="text-lg font-bold text-green-600">{itemCount}</p><p className="text-[11px] text-gray-500">بند شراء</p></CardContent></Card>
      </div>

      <Card className="border-0 shadow-md"><CardContent className="p-4"><div className="relative"><Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-10" placeholder="بحث برقم الوصل أو اسم المورد..." /></div></CardContent></Card>

      <div className="grid gap-3">
        {purchases?.map((purchase) => (
          <Card key={purchase.id} className="border-0 shadow-md hover:shadow-lg transition-shadow"><CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 text-primary-600 flex items-center justify-center flex-shrink-0"><FileText className="w-6 h-6" /></div>
                <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="font-bold truncate">{formatDocumentNumber(purchase.purchaseNumber)}</p><Badge variant={purchase.paymentMethod === 'cash' ? 'success' : 'warning'} className="text-[10px]">{saleTypeLabel(purchase.paymentMethod)}</Badge></div><p className="text-sm text-gray-600 dark:text-gray-400 truncate">{purchase.supplierName} • {formatDate(purchase.date, true)} • {purchase.itemsCount} مادة</p></div>
              </div>
              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3"><div className="text-right min-w-0"><p className="font-bold whitespace-nowrap">{formatCurrency(purchase.total, settings?.currency)}</p>{purchase.remaining > 0 && <p className="text-xs text-red-600 whitespace-nowrap">متبقي: {formatCurrency(purchase.remaining, settings?.currency)}</p>}</div><div className="flex flex-wrap gap-1"><Link to={`/purchases/${purchase.id}`} aria-label="عرض وصل الشراء" title="عرض وصل الشراء"><Button variant="ghost" size="icon" className="h-8 w-8" tabIndex={-1}><Eye className="w-4 h-4" /></Button></Link><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="طباعة وصل الشراء" title="طباعة وصل الشراء" onClick={() => handlePrint(purchase.id!)} disabled={busyId !== null}><Printer className="w-4 h-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="حفظ وصل الشراء كمستند" title="حفظ وصل الشراء كمستند" onClick={() => handlePdf(purchase.id!)} disabled={busyId !== null}><Download className="w-4 h-4" /></Button><Link to={`/purchases/${purchase.id}/edit`} aria-label="تعديل وصل الشراء" title="تعديل وصل الشراء"><Button variant="ghost" size="icon" className="h-8 w-8" tabIndex={-1}><Edit className="w-4 h-4" /></Button></Link><Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" aria-label="حذف وصل الشراء" title="حذف وصل الشراء" onClick={() => handleDelete(purchase.id!)} disabled={busyId === purchase.id}><Trash2 className="w-4 h-4" /></Button></div></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      <SalesVsPurchaseHelpDialog open={showHelp} onClose={() => setShowHelp(false)} />

      {purchases?.length === 0 && <Card className="border-0 shadow-md"><CardContent className="text-center py-16"><ClipboardList className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" /><h3 className="font-bold mb-2">لا توجد وصول شراء</h3><p className="text-sm text-gray-500 mb-4">ابدأ بإدخال أول فاتورة شراء، ويمكنك تسجيل مادة جديدة من داخلها.</p><Link to="/purchases/new"><Button><Plus className="w-4 h-4 ml-2" />وصل شراء جديد</Button></Link></CardContent></Card>}
    </div>
  );
}
