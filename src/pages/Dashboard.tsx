import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  FileText, 
  Package, 
  Users, 
  CreditCard, 
  TrendingUp, 
  AlertTriangle,
  HelpCircle,
  Plus,
  Wallet,
  ShoppingCart,
  ArrowUpRight,
  DollarSign
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, checkLowStock } from '@/lib/db';
import { getCustomerBalances } from '@/lib/debts';
import { logBackgroundFailure } from '@/lib/lifecycle';
import { useLiveQuery } from 'dexie-react-hooks';
import { useOfficeSettings } from '@/hooks/useOfficeSettings';
import { OverflowMarquee } from '@/components/ui/OverflowMarquee';
import { SalesVsPurchaseHelpDialog } from '@/components/help/SalesVsPurchaseHelpDialog';
import { usePermission } from '@/hooks/useSession';
import { formatDocumentNumber } from '@/lib/labels';
import type { Permission } from '@/lib/permissions';
import { formatCurrency, formatLocalDateInput, getStockStatus, isSameLocalDay, roundMoney, toFiniteNumber } from '@/lib/utils';
export function Dashboard() {
  const settings = useOfficeSettings();
  const can = usePermission();
  const officeName = settings?.officeName?.trim() || '';
  const today = formatLocalDateInput();
  const [showHelp, setShowHelp] = useState(false);

  const recentInvoices = useLiveQuery(() => db.invoices.orderBy('createdAt').reverse().limit(5).toArray(), []);

  const lowStockMaterials = useLiveQuery(async () => {
    const all = await db.materials.toArray();
    return all
      .filter((material) => getStockStatus(material.quantity, material.minQuantity) !== 'normal')
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 5);
  }, []);

  const topDebtors = useLiveQuery(async () => {
    const [customers, balances] = await Promise.all([db.customers.toArray(), getCustomerBalances()]);
    return customers
      .map((customer) => ({ customer, debt: balances.get(customer.id as number)?.debt ?? 0 }))
      .filter((entry) => entry.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 5);
  }, []);

  // الإحصاءات كانت تُحمّل مرة واحدة فقط عند دخول لوحة التحكم، فتظل قديمة
  // بعد حفظ فاتورة أو تسديد. جعلها live query يربط العرض مباشرة بقاعدة
  // البيانات ويمنع ترتيباً خاطئاً بين الحفظ والتحديث البصري.
  const stats = useLiveQuery(async () => {
    const [materials, customersCount, invoices, payments, balances] = await Promise.all([
      db.materials.toArray(),
      db.customers.count(),
      db.invoices.toArray(),
      db.payments.toArray(),
      getCustomerBalances()
    ]);
    const totalDebt = roundMoney(
      Array.from(balances.values()).reduce((sum, balance) => sum + (balance.debt > 0 ? balance.debt : 0), 0)
    );
    const todayInvoicesList = invoices.filter((invoice) => isSameLocalDay(invoice.date, today));
    const todayCash = roundMoney(
      todayInvoicesList
        .filter((invoice) => invoice.type === 'cash')
        .reduce((sum, invoice) => sum + toFiniteNumber(invoice.total), 0) +
        payments
          .filter((payment) => isSameLocalDay(payment.date, today))
          .reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0)
    );
    return {
      totalMaterials: materials.length,
      totalCustomers: customersCount,
      totalInvoices: invoices.length,
      totalDebt,
      todayCash,
      todayInvoices: todayInvoicesList.length,
      lowStock: materials.filter((material) => getStockStatus(material.quantity, material.minQuantity) !== 'normal').length,
      totalPayments: roundMoney(payments.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0))
    };
  }, [today]) ?? {
    totalMaterials: 0,
    totalCustomers: 0,
    totalInvoices: 0,
    totalDebt: 0,
    todayCash: 0,
    todayInvoices: 0,
    lowStock: 0,
    totalPayments: 0
  };

  useEffect(() => {
    let cancelled = false;
    void checkLowStock().catch((error) => {
      // الإلغاء الناتج عن إغلاق التطبيق أو مغادرة الشاشة ليس عطلاً
      if (!cancelled) logBackgroundFailure('تعذّر فحص المخزون:', error);
    });
    return () => {
      cancelled = true;
    };
  }, [settings?.lowStockThreshold]);

  // الإجراءات السريعة حسب صلاحية المستخدم (موظف المبيعات لا يرى وصل الشراء
  // ولا إضافة مادة) — نفس المصفوفة التي تحرس المسارات وطبقة البيانات
  // `tag` يوضّح اتجاه حركة المواد على البطاقة نفسها، فلا يبقى الفرق بين
  // فاتورة البيع ووصل الشراء موكولاً إلى تجربة المستخدم وحدها
  const allQuickActions: Array<{ title: string; desc: string; tag?: string; icon: typeof FileText; color: string; href: string; count: number | null; permission: Permission }> = [
    { title: 'فاتورة بيع جديدة', desc: 'بيع للزبون: تخرج المواد من المخزن وتُسجَّل مبيعاتك', tag: 'مبيعات — خروج من المخزن', icon: FileText, color: 'bg-gray-900 dark:bg-white', href: '/invoices/new', count: null, permission: 'sales.create' },
    { title: 'وصل شراء جديد', desc: 'شراء من مورد: تدخل المواد للمخزن وتُسجَّل مشترياتك', tag: 'مشتريات — إدخال إلى المخزن', icon: ShoppingCart, color: 'bg-gray-900 dark:bg-white', href: '/purchases/new', count: null, permission: 'purchases.manage' },
    { title: 'تسديد دين', desc: 'تسجيل دفعة من زبون', icon: CreditCard, color: 'bg-gray-900 dark:bg-white', href: '/payments/new', count: null, permission: 'payments.create' },
    { title: 'إضافة مادة', desc: 'إضافة مادة جديدة للمخزن', icon: Package, color: 'bg-gray-900 dark:bg-white', href: '/materials?action=new', count: stats.totalMaterials, permission: 'materials.manage' },
    { title: 'الزبائن والديون', desc: 'عرض كشف الزبائن', icon: Users, color: 'bg-gray-900 dark:bg-white', href: '/customers', count: stats.totalCustomers, permission: 'customers.view' },
  ];
  const quickActions = allQuickActions.filter((action) => can(action.permission));

  const statCards = [
    { title: 'مبيعات اليوم', value: formatCurrency(stats.todayCash, settings?.currency), icon: Wallet, change: `${stats.todayInvoices} فاتورة`, color: 'text-green-600 bg-green-50 dark:bg-green-900/20', trend: 'up' },
    { title: 'إجمالي الديون', value: formatCurrency(stats.totalDebt, settings?.currency), icon: DollarSign, change: `${topDebtors?.length || 0} مدين`, color: 'text-red-600 bg-red-50 dark:bg-red-900/20', trend: 'down' },
    { title: 'المواد', value: stats.totalMaterials.toString(), icon: Package, change: `${stats.lowStock} منخفض`, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20', trend: stats.lowStock > 0 ? 'down' : 'up' },
    { title: 'العملاء', value: stats.totalCustomers.toString(), icon: Users, change: `${stats.totalInvoices} فاتورة`, color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20', trend: 'up' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 dark:from-black dark:via-gray-950 dark:to-gray-900 ring-1 ring-primary-500/30 rounded-2xl p-6 lg:p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-black/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              {/* اسم المكتب وحده بخط أصغر؛ إن تجاوز عرض الترويسة يتحرك
                  (شريط متحرك) بدل أن يُقتطع — انظر OverflowMarquee */}
              <OverflowMarquee
                as="h1"
                text={officeName || 'إدارة المكتب'}
                className="text-lg sm:text-xl font-bold mb-2 leading-relaxed"
                data-testid="dashboard-office-name"
              />
              <div className="flex min-w-0 items-center gap-2 text-white/80 text-sm lg:text-base whitespace-nowrap overflow-hidden">
                <span className="truncate">نظام إدارة متكامل - دون اتصال بالانترنت</span>
                <span className="bg-red-500 w-2 h-2 rounded-full shrink-0 animate-pulse" aria-hidden="true" />
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/invoices/new">
                <Button className="bg-white text-primary-700 hover:bg-gray-100 font-bold shadow-lg">
                  <Plus className="w-4 h-4 ml-2" />
                  فاتورة جديدة
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions - Big Buttons */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">إجراءات سريعة</h2>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowHelp(true)}>
            <HelpCircle className="w-4 h-4 ml-1" />
            ما الفرق بين فاتورة البيع ووصل الشراء؟
          </Button>
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${quickActions.length >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-3'}`}>
          {quickActions.map((action, idx) => (
            <Link key={idx} to={action.href}>
              <Card className="hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group border-0 shadow-md h-full">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 rounded-xl ${action.color} flex items-center justify-center text-white dark:text-gray-900 shadow-lg group-hover:scale-110 transition-transform`}>
                      <action.icon className="w-6 h-6" />
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                  </div>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-1">{action.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{action.desc}</p>
                  {(action.tag || action.count !== null) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {action.tag && <Badge variant="outline" className="text-[10px]">{action.tag}</Badge>}
                      {action.count !== null && (
                        <Badge variant="secondary" className="text-[11px]">{action.count} عنصر</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <SalesVsPurchaseHelpDialog open={showHelp} onClose={() => setShowHelp(false)} />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, idx) => (
          <Card key={idx} className="border-0 shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${stat.trend === 'up' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                  <TrendingUp className={`w-3 h-3 ${stat.trend === 'down' ? 'rotate-180' : ''}`} />
                  {stat.change}
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{stat.title}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices */}
        <Card className="lg:col-span-2 border-0 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary-600" />
              آخر الفواتير
            </CardTitle>
            <Link to="/invoices">
              <Button variant="ghost" size="sm">عرض الكل</Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentInvoices?.length ? recentInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${inv.type === 'cash' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'}`}>
                      {inv.type === 'cash' ? <Wallet className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{formatDocumentNumber(inv.invoiceNumber)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{inv.customerName} • {new Date(inv.date).toLocaleDateString('ar-EG')}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="font-bold text-sm text-gray-900 dark:text-white">{formatCurrency(inv.total, settings?.currency)}</p>
                    <Badge variant={inv.type === 'cash' ? 'success' : 'warning'} className="text-[10px] mt-1">
                      {inv.type === 'cash' ? 'نقدي' : 'آجل'}
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12">
                  <ShoppingCart className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">لا توجد فواتير بعد</p>
                  <Link to="/invoices/new" className="inline-block mt-3">
                    <Button size="sm">إنشاء أول فاتورة</Button>
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alerts & Debtors */}
        <div className="space-y-6">
          {/* Low Stock */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                تنبيهات المخزون
                {stats.lowStock > 0 && <Badge variant="destructive" className="mr-auto">{stats.lowStock}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lowStockMaterials?.length ? lowStockMaterials.map((mat) => (
                  <div key={mat.id} className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{mat.name}</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">المتبقي: {mat.quantity} {mat.unit || 'قطعة'}</p>
                    </div>
                    <Badge variant="warning" className="text-[10px]">منخفض</Badge>
                  </div>
                )) : (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-2">
                      <Package className="w-6 h-6 text-green-600" />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">جميع المواد متوفرة</p>
                  </div>
                )}
                {lowStockMaterials && lowStockMaterials.length > 0 && (
                  <Link to="/materials" className="block mt-3">
                    <Button variant="outline" size="sm" className="w-full text-xs">عرض المخزن</Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Debtors */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-5 h-5 text-red-600" />
                أكبر المدينين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topDebtors?.length ? topDebtors.map(({ customer, debt }) => (
                  <div key={customer.id} className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white text-xs font-bold">
                        {customer.fullName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[100px]">{customer.fullName}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{customer.phone || 'بدون هاتف'}</p>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-red-600 dark:text-red-400">{formatCurrency(debt, settings?.currency)}</p>
                  </div>
                )) : (
                  <div className="text-center py-6">
                    <Users className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-500 dark:text-gray-400">لا توجد ديون حالياً</p>
                  </div>
                )}
                <Link to="/customers" className="block mt-3">
                  <Button variant="outline" size="sm" className="w-full text-xs">عرض جميع العملاء</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
