import { useState, useEffect } from 'react';
import { BarChart3, DollarSign, Users, Package, TrendingUp, Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings } from '@/lib/db';
import { saveFile } from '@/lib/files';
import { getCustomerBalances } from '@/lib/debts';
import { formatCurrency, formatDate, formatLocalDateInput, localDayRangeISO, roundMoney, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { OfficeSettings, Material, Customer } from '@/types';
import { useLiveQuery } from 'dexie-react-hooks';

type ReportKey = 'cash' | 'debts' | 'materials' | 'profit' | 'inventory';

interface MaterialSaleRow {
  invoiceId: number;
  customerName: string;
  quantity: number;
  date: string;
  total: number;
  invoiceNumber: string;
}

interface MaterialMovementReport {
  material: Material;
  totalSold: number;
  totalRevenue: number;
  totalProfit: number;
  sales: MaterialSaleRow[];
  currentStock: number;
}

export function Reports() {
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [dateFrom, setDateFrom] = useState(formatLocalDateInput());
  const [dateTo, setDateTo] = useState(formatLocalDateInput());
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [searchMaterial, setSearchMaterial] = useState('');
  const [activeReport, setActiveReport] = useState<ReportKey>('cash');
  const [isExporting, setIsExporting] = useState(false);

  const materials = useLiveQuery(() => db.materials.toArray(), []);

  const [cashReport, setCashReport] = useState({ cashInvoices: 0, payments: 0, total: 0, count: 0 });
  const [debtsReport, setDebtsReport] = useState<{ customer: Customer; debt: number }[]>([]);
  const [materialMovement, setMaterialMovement] = useState<MaterialMovementReport | null>(null);
  const [profitReport, setProfitReport] = useState({ totalSales: 0, totalCost: 0, profit: 0, margin: 0 });
  const [inventoryReport, setInventoryReport] = useState({ totalValue: 0, totalItems: 0, lowStock: 0, outOfStock: 0 });

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setSettings(s || null);
      } catch (error) {
        if (!cancelled) reportError('Reports.settings', error, 'تعذّر تحميل الإعدادات');
      }
    };

    const loadReports = async () => {
      try {
        await Promise.all([
          loadCashReport(),
          loadDebtsReport(),
          loadProfitReport(),
          loadInventoryReport(),
          selectedMaterial ? loadMaterialMovement() : Promise.resolve()
        ]);
      } catch (error) {
        if (!cancelled) reportError('Reports.load', error, 'تعذّر تحميل التقارير');
      }
    };

    void loadSettings();
    void loadReports();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, selectedMaterial, activeReport]);

  /**
   * نطاق التاريخ يُحسب محلياً. الحقل الفارغ كان يُنتج Invalid Date ثم
   * RangeError: Invalid time value فيُعطّل تحميل كل التقارير بصمت.
   */
  const resolveRange = () => {
    const range = localDayRangeISO(dateFrom, dateTo);
    if (!range) {
      setRangeError('يرجى اختيار تاريخ "من" و"إلى" صالحين');
      return null;
    }
    setRangeError(null);
    return range;
  };

  const loadCashReport = async () => {
    const range = resolveRange();
    if (!range) {
      setCashReport({ cashInvoices: 0, payments: 0, total: 0, count: 0 });
      return;
    }

    const [invoices, payments] = await Promise.all([
      db.invoices.where('date').between(range.from, range.to, true, true).toArray(),
      db.payments.where('date').between(range.from, range.to, true, true).toArray()
    ]);

    const cashInvoices = invoices.filter((invoice) => invoice.type === 'cash');
    const cashTotal = roundMoney(cashInvoices.reduce((sum, invoice) => sum + toFiniteNumber(invoice.total), 0));
    const paymentsTotal = roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0));

    setCashReport({
      cashInvoices: cashTotal,
      payments: paymentsTotal,
      total: roundMoney(cashTotal + paymentsTotal),
      count: cashInvoices.length + payments.length
    });
  };

  const loadDebtsReport = async () => {
    const [customers, balances] = await Promise.all([db.customers.toArray(), getCustomerBalances()]);
    const combined = customers
      .map((customer) => ({ customer, debt: balances.get(customer.id as number)?.debt ?? 0 }))
      .filter((entry) => entry.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    setDebtsReport(combined);
  };

  const loadMaterialMovement = async () => {
    if (!selectedMaterial?.id) return;
    
    const items = await db.invoiceItems.where('materialId').equals(selectedMaterial.id).toArray();
    const invoices = await db.invoices.bulkGet(items.map(i => i.invoiceId));
    
    const sales = items.map(item => {
      const inv = invoices.find(i => i?.id === item.invoiceId);
      return {
        invoiceId: item.invoiceId,
        customerName: inv?.customerName || 'غير معروف',
        quantity: item.quantity,
        date: inv?.date || '',
        total: item.total,
        invoiceNumber: inv?.invoiceNumber || ''
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalSold = items.reduce((sum, i) => sum + toFiniteNumber(i.quantity), 0);
    const totalRevenue = items.reduce((sum, i) => sum + toFiniteNumber(i.total), 0);
    const totalProfit = selectedMaterial.purchasePrice
      ? items.reduce((sum, i) => sum + (toFiniteNumber(i.unitPrice) - toFiniteNumber(selectedMaterial.purchasePrice)) * toFiniteNumber(i.quantity), 0)
      : 0;

    setMaterialMovement({
      material: selectedMaterial,
      totalSold: roundMoney(totalSold),
      totalRevenue: roundMoney(totalRevenue),
      totalProfit: roundMoney(totalProfit),
      sales,
      currentStock: toFiniteNumber(selectedMaterial.quantity)
    });
  };

  const loadProfitReport = async () => {
    const range = resolveRange();
    if (!range) {
      setProfitReport({ totalSales: 0, totalCost: 0, profit: 0, margin: 0 });
      return;
    }

    const invoices = await db.invoices.where('date').between(range.from, range.to, true, true).toArray();
    const invoiceIds = invoices.map((invoice) => invoice.id as number).filter((id) => typeof id === 'number');
    const items = invoiceIds.length ? await db.invoiceItems.where('invoiceId').anyOf(invoiceIds).toArray() : [];

    const totalSales = roundMoney(items.reduce((sum, item) => sum + toFiniteNumber(item.total), 0));
    const totalCost = roundMoney(
      items.reduce((sum, item) => sum + roundMoney(toFiniteNumber(item.purchasePrice) * toFiniteNumber(item.quantity)), 0)
    );
    const profit = roundMoney(totalSales - totalCost);

    setProfitReport({
      totalSales,
      totalCost,
      profit,
      margin: totalSales > 0 ? (profit / totalSales) * 100 : 0
    });
  };

  const loadInventoryReport = async () => {
    const mats = await db.materials.toArray();
    const totalValue = roundMoney(mats.reduce((sum, m) => sum + roundMoney(toFiniteNumber(m.quantity) * toFiniteNumber(m.salePrice)), 0));
    const lowStock = mats.filter((m) => toFiniteNumber(m.quantity) > 0 && toFiniteNumber(m.quantity) <= toFiniteNumber(m.minQuantity)).length;
    const outOfStock = mats.filter((m) => toFiniteNumber(m.quantity) <= 0).length;

    setInventoryReport({
      totalValue,
      totalItems: mats.length,
      lowStock,
      outOfStock
    });
  };

  const filteredMaterials = materials?.filter(m => 
    m.name.toLowerCase().includes(searchMaterial.toLowerCase())
  ).slice(0, 10) || [];

  const totalDebt = debtsReport.reduce((sum, d) => sum + d.debt, 0);

  const exportReport = async () => {
    if (isExporting) return;
    if (activeReport === 'materials' && !materialMovement) {
      toast.warning('اختر مادة أولاً', 'حدد مادة لعرض تقرير حركتها ثم صدّر التقرير');
      return;
    }
    setIsExporting(true);
    let data: unknown = {};
    let fileName = '';

    const REPORT_LABELS: Record<ReportKey, string> = {
      cash: 'حركة الصندوق',
      debts: 'الديون الشامل',
      materials: 'حركة مادة',
      profit: 'الأرباح',
      inventory: 'قيمة المخزون'
    };

    switch (activeReport) {
      case 'cash':
        data = { report: REPORT_LABELS.cash, from: dateFrom, to: dateTo, ...cashReport };
        fileName = `Cash_Report_${dateFrom}_to_${dateTo}.json`;
        break;
      case 'debts':
        data = {
          report: REPORT_LABELS.debts,
          date: formatLocalDateInput(),
          totalDebt,
          debtors: debtsReport.map(({ customer, debt }) => ({
            name: customer.fullName,
            phone: customer.phone || '',
            debt
          }))
        };
        fileName = `Debts_Report_${formatLocalDateInput()}.json`;
        break;
      case 'materials':
        data = {
          report: REPORT_LABELS.materials,
          material: materialMovement?.material.name || '',
          totalSold: materialMovement?.totalSold || 0,
          totalRevenue: materialMovement?.totalRevenue || 0,
          currentStock: materialMovement?.currentStock || 0,
          sales: materialMovement?.sales || []
        };
        fileName = `Material_Movement_${formatLocalDateInput()}.json`;
        break;
      case 'profit':
        data = { report: REPORT_LABELS.profit, from: dateFrom, to: dateTo, ...profitReport };
        fileName = `Profit_Report_${dateFrom}_to_${dateTo}.json`;
        break;
      default:
        data = {
          report: REPORT_LABELS.inventory,
          date: formatLocalDateInput(),
          ...inventoryReport
        };
        fileName = `Inventory_Report_${formatLocalDateInput()}.json`;
    }

    // الحفظ عبر الخدمة الموحّدة: يعمل على أندرويد (مستندات/مشاركة) بدل
    // تنزيل المتصفح الذي لا يفعل شيئاً داخل WebView.
    try {
      const result = await saveFile({
        fileName,
        mimeType: 'application/json',
        data: JSON.stringify(data, null, 2),
        encoding: 'utf8',
        subDir: 'Reports',
        shareTitle: `تقرير ${REPORT_LABELS[activeReport]}`
      });
      if (!result.ok) {
        if (result.error === 'CANCELLED') return;
        toast.error('تعذّر تصدير التقرير', result.error);
        return;
      }
      toast.success('تم تصدير التقرير', result.path || fileName);
    } catch (error) {
      reportError('Reports.export', error, 'تعذّر تصدير التقرير');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary-600" />
            التقارير والإحصائيات
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">تقارير شاملة لإدارة المكتب الزراعي</p>
        </div>
        <Button variant="outline" onClick={exportReport} disabled={isExporting}>
          {isExporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
          {isExporting ? 'جاري التخزين…' : 'تصدير التقرير'}
        </Button>
      </div>

      {/* Report Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="أنواع التقارير">
        {[
          { id: 'cash', label: 'حركة الصندوق', icon: DollarSign },
          { id: 'debts', label: 'الديون الشامل', icon: Users },
          { id: 'materials', label: 'حركة مادة', icon: Package },
          { id: 'profit', label: 'الأرباح', icon: TrendingUp },
          { id: 'inventory', label: 'قيمة المخزون', icon: BarChart3 },
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeReport === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveReport(tab.id as ReportKey)}
            className={`shrink-0 ${activeReport === tab.id ? 'bg-primary-600' : ''}`}
            role="tab"
            aria-selected={activeReport === tab.id}
          >
            <tab.icon className="w-4 h-4 ml-1" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Date Filter */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">من تاريخ</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">إلى تاريخ</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="flex-1 lg:flex-none" onClick={() => { const today = formatLocalDateInput(); setDateFrom(today); setDateTo(today); }}>اليوم</Button>
              <Button variant="outline" size="sm" className="flex-1 lg:flex-none" onClick={() => { const d = new Date(); const first = formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1)); setDateFrom(first); setDateTo(formatLocalDateInput()); }}>هذا الشهر</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {rangeError && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
          {rangeError}
        </div>
      )}

      {/* Cash Report */}
      {activeReport === 'cash' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-md bg-gradient-to-br from-gray-900 to-gray-800 dark:from-black dark:to-gray-900 text-white ring-1 ring-primary-500/30">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-100 text-xs">إجمالي الكاش اليومي</p>
                    <p className="text-2xl font-bold mt-1">{formatCurrency(cashReport.total, settings?.currency)}</p>
                    <p className="text-green-100 text-[11px] mt-1">{cashReport.count} عملية</p>
                  </div>
                  <DollarSign className="w-10 h-10 text-white/30" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">مبيعات نقدية</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(cashReport.cashInvoices, settings?.currency)}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">تسديدات ديون</p>
                <p className="text-lg font-bold text-blue-600">{formatCurrency(cashReport.payments, settings?.currency)}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">الغلة اليومية</p>
                <p className="text-lg font-bold">{formatCurrency(cashReport.total, settings?.currency)}</p>
                <p className="text-[11px] text-gray-500">صافي الدخل</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base">تفاصيل حركة الصندوق - {formatDate(dateFrom)} إلى {formatDate(dateTo)}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800/30">
                  <span className="text-sm font-medium">مبيعات نقدية</span>
                  <span className="font-bold text-green-600">{formatCurrency(cashReport.cashInvoices, settings?.currency)}</span>
                </div>
                <div className="flex justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800/30">
                  <span className="text-sm font-medium">تسديدات الزبائن</span>
                  <span className="font-bold text-blue-600">{formatCurrency(cashReport.payments, settings?.currency)}</span>
                </div>
                <div className="h-px bg-gray-200 dark:bg-gray-700" />
                <div className="flex justify-between p-4 bg-gray-900 dark:bg-gray-800 text-white rounded-xl">
                  <span className="font-bold">الإجمالي الكلي للصندوق</span>
                  <span className="font-bold text-xl">{formatCurrency(cashReport.total, settings?.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Debts Report */}
      {activeReport === 'debts' && (
        <div className="space-y-4">
          <Card className="border-0 shadow-md bg-gradient-to-br from-gray-900 to-gray-800 dark:from-black dark:to-gray-900 text-white ring-1 ring-primary-500/30">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-xs">إجمالي الأموال المطلوبة في السوق</p>
                  <p className="text-3xl font-bold mt-1">{formatCurrency(totalDebt, settings?.currency)}</p>
                  <p className="text-white/80 text-xs mt-1">{debtsReport.length} زبون مدين</p>
                </div>
                <Users className="w-12 h-12 text-white/30" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base">قائمة الزبائن المدينين - مرتبة حسب أكبر دين</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {debtsReport.map(({ customer, debt }, idx) => (
                  <div key={customer.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{customer.fullName}</p>
                        <p className="text-xs text-gray-500">{customer.phone} • {customer.address}</p>
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-red-600">{formatCurrency(debt, settings?.currency)}</p>
                      <Badge variant={debt > 1000000 ? 'destructive' : debt > 500000 ? 'warning' : 'secondary'} className="text-[10px] mt-1">
                        {debt > 1000000 ? 'دين كبير' : debt > 500000 ? 'متوسط' : 'صغير'}
                      </Badge>
                    </div>
                  </div>
                ))}
                {debtsReport.length === 0 && <p className="text-center text-sm text-gray-500 py-12">لا توجد ديون - جميع الزبائن خالصين ✓</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Material Movement */}
      {activeReport === 'materials' && (
        <div className="space-y-4">
          <Card className="border-0 shadow-md">
            <CardContent className="p-4">
              <label className="text-sm font-medium mb-2 block">اختر مادة لعرض حركتها</label>
              <div className="relative">
                <Input placeholder="ابحث عن مادة..." value={searchMaterial} onChange={(e) => setSearchMaterial(e.target.value)} />
                {searchMaterial && filteredMaterials.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    {filteredMaterials.map(m => (
                      <button key={m.id} onClick={() => { setSelectedMaterial(m); setSearchMaterial(''); }} className="w-full text-right p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                        {m.name} - متوفر: {m.quantity} {m.unit}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedMaterial && (
                <div className="mt-3 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-xl flex justify-between items-center">
                  <span className="font-medium">{selectedMaterial.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedMaterial(null)}>إزالة</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {materialMovement ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">إجمالي المباع</p><p className="text-lg font-bold">{materialMovement.totalSold} {materialMovement.material.unit}</p></CardContent></Card>
                <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">إجمالي الإيراد</p><p className="text-lg font-bold text-green-600">{formatCurrency(materialMovement.totalRevenue, settings?.currency)}</p></CardContent></Card>
                <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">الربح</p><p className="text-lg font-bold text-primary-600">{formatCurrency(materialMovement.totalProfit, settings?.currency)}</p></CardContent></Card>
                <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">المتبقي</p><p className="text-lg font-bold">{materialMovement.currentStock} {materialMovement.material.unit}</p></CardContent></Card>
              </div>

              <Card className="border-0 shadow-md">
                <CardHeader><CardTitle className="text-base">سجل مبيعات المادة - {materialMovement.material.name}</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {materialMovement.sales.map((sale, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm">
                        <div>
                          <p className="font-medium">{sale.customerName}</p>
                          <p className="text-xs text-gray-500">{formatDate(sale.date)} • {sale.invoiceNumber}</p>
                        </div>
                        <div className="text-left">
                          <p className="font-bold">{sale.quantity} {materialMovement.material.unit}</p>
                          <p className="text-xs text-green-600">{formatCurrency(sale.total, settings?.currency)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-0 shadow-md"><CardContent className="text-center py-16"><Package className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">اختر مادة لعرض تقرير حركتها</p></CardContent></Card>
          )}
        </div>
      )}

      {/* Profit Report */}
      {activeReport === 'profit' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">إجمالي المبيعات</p><p className="text-lg font-bold">{formatCurrency(profitReport.totalSales, settings?.currency)}</p></CardContent></Card>
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">تكلفة البضاعة</p><p className="text-lg font-bold text-red-600">{formatCurrency(profitReport.totalCost, settings?.currency)}</p></CardContent></Card>
            <Card className="border-0 shadow-md bg-gradient-to-br from-gray-900 to-gray-800 dark:from-black dark:to-gray-900 text-white ring-1 ring-primary-500/30"><CardContent className="p-4"><p className="text-gray-400 text-xs">صافي الربح</p><p className="text-xl font-bold">{formatCurrency(profitReport.profit, settings?.currency)}</p><p className="text-gray-400 text-[11px]">{profitReport.margin.toFixed(1)}% هامش</p></CardContent></Card>
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">هامش الربح</p><p className="text-lg font-bold text-primary-600">{profitReport.margin.toFixed(1)}%</p></CardContent></Card>
          </div>
        </div>
      )}

      {/* Inventory Report */}
      {activeReport === 'inventory' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-md bg-gradient-to-br from-gray-900 to-gray-800 dark:from-black dark:to-gray-900 text-white ring-1 ring-primary-500/30"><CardContent className="p-6"><p className="text-gray-400 text-xs">قيمة المخزون الإجمالية</p><p className="text-2xl font-bold mt-1">{formatCurrency(inventoryReport.totalValue, settings?.currency)}</p></CardContent></Card>
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">عدد الأصناف</p><p className="text-xl font-bold">{inventoryReport.totalItems}</p></CardContent></Card>
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">منخفضة المخزون</p><p className="text-xl font-bold text-amber-600">{inventoryReport.lowStock}</p></CardContent></Card>
            <Card className="border-0 shadow-md"><CardContent className="p-4"><p className="text-xs text-gray-500">نافدة</p><p className="text-xl font-bold text-red-600">{inventoryReport.outOfStock}</p></CardContent></Card>
          </div>
        </div>
      )}
    </div>
  );
}
