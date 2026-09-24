import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  FileText, 
  ClipboardList,
  CreditCard, 
  BarChart3, 
  Settings, 
  Bell,
  Menu,
  X,
  Sun,
  Moon,
  Database
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, countUnreadNotifications } from '@/lib/db';
import { getStockStatus } from '@/lib/utils';
import { officeNameLengthClass } from '@/lib/officeName';
import type { OfficeSettings } from '@/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { useOfficeSettings } from '@/hooks/useOfficeSettings';
import { useModalCloser } from '@/hooks/useModalCloser';
import { useTheme } from '@/hooks/useTheme';

interface LayoutProps {
  children: React.ReactNode;
  /**
   * إعدادات محمّلة مسبقاً من شاشة الإقلاع: تُعرض فوراً في الترويسة حتى قبل
   * وصول نتيجة الاستعلام الحيّ، فلا يظهر اسم المكتب فارغاً للحظة بعد
   * معالج التشغيل الأول (وميض بصري + نتائج اختبار غير حتمية).
   */
  initialSettings?: OfficeSettings | null;
}

const navigation = [
  { name: 'لوحة التحكم', href: '/', icon: LayoutDashboard },
  { name: 'المخزن والمواد', href: '/materials', icon: Package },
  { name: 'العملاء', href: '/customers', icon: Users },
  { name: 'الفواتير والمبيعات', href: '/invoices', icon: FileText },
  { name: 'وصول الشراء', href: '/purchases', icon: ClipboardList },
  { name: 'التسديدات', href: '/payments', icon: CreditCard },
  { name: 'التقارير', href: '/reports', icon: BarChart3 },
  { name: 'النسخ الاحتياطي', href: '/backup', icon: Database },
  { name: 'الإعدادات', href: '/settings', icon: Settings },
];

export function Layout({ children, initialSettings = null }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  // السمة مصدرها مخزن واحد مشترك: أي تبديل من الإعدادات أو التخطيط يظهر
  // فوراً في كل مكان بلا رسم متتالٍ داخل تأثير.
  const { isDark, toggleTheme } = useTheme();

  // الإعدادات تأتي من المخزن المشترك: تُنشَر عند الحفظ وعند كل قراءة، فتظهر
  // القيمة المحفوظة في أول رسم بلا انتظار استعلام حيّ (سبب ظهور الاسم
  // الافتراضي لحظةً بعد الإعداد في النسخة السابقة).
  const settings = useOfficeSettings(initialSettings);

  const unreadNotifications = useLiveQuery(() => countUnreadNotifications(), []) || 0;
  const lowStockCount = useLiveQuery(async () => {
    const materials = await db.materials.toArray();
    return materials.filter((material) => getStockStatus(material.quantity, material.minQuantity) !== 'normal').length;
  }, []) || 0;

  // الدرج الجانبي في الجوال يُغلق بزر الرجوع و Escape مثل أي نافذة
  useModalCloser(sidebarOpen, () => setSidebarOpen(false), { label: 'قائمة التنقل' });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 font-cairo">
      {/* Sidebar - Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 right-0 z-50 w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo */}
          <div className="flex-none flex items-center justify-between h-20 px-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              {settings?.logo ? (
                <img src={settings.logo} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-xl">
                  م
                </div>
              )}
              <div className="min-w-0">
                {/* الاسم الكامل يظهر دائماً: يلتف على سطرين بدل أن يُقتطع،
                    ويُعرض كاملاً في التلميح عند تجاوز الطول المتاح */}
                <h1
                  className={`font-bold text-gray-900 dark:text-white text-sm leading-tight office-name ${officeNameLengthClass(settings?.officeName)}`}
                  title={settings?.officeName || undefined}
                >
                  {settings?.officeName || 'إعداد المكتب مطلوب'}
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">إدارة متكاملة</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="إغلاق قائمة التنقل"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Navigation
              min-h-0 إلزامي هنا: بدونها لا ينكمش عنصر flex تحت حجم محتواه
              (الافتراضي min-height: auto) فلا يعمل التمرير داخل القائمة أبداً،
              وتُصبح البنود الأخيرة خارج الشاشة بلا إمكانية نقر، ويتسرب
              التمرير إلى الصفحة الخلفية.
              overscroll-contain يمنع "تسلسل" التمرير إلى الخلفية عند تجاوز
              حدود القائمة. */}
          <nav
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-6 space-y-1"
            aria-label="التنقل الرئيسي"
          >
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                  {item.href === '/materials' && lowStockCount > 0 && (
                    <Badge variant="destructive" className="mr-auto text-[10px] px-1.5 py-0">
                      {lowStockCount}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="flex-none p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-2">
              <span>الإصدار 1.0.0</span>
              <span>© 2024</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pr-72">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between h-16 px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="فتح قائمة التنقل"
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="hidden lg:block">
                <h2 className="font-bold text-gray-900 dark:text-white">
                  {navigation.find(n => n.href === location.pathname || (n.href !== '/' && location.pathname.startsWith(n.href)))?.name || 'لوحة التحكم'}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
                {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </Button>
              
              <Link to="/notifications">
                <Button variant="ghost" size="icon" className="rounded-full relative">
                  <Bell className="w-5 h-5" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                  )}
                </Button>
              </Link>

              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm shrink-0 border border-primary-600/30">
                  {settings?.logo ? (
                    <img
                      src={settings.logo}
                      alt={settings.officeName || 'شعار المكتب'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{settings?.officeName ? settings.officeName.trim().charAt(0) : 'م'}</span>
                  )}
                </div>
                <div className="hidden md:block text-right">
                  <p className="text-sm font-medium text-gray-900 dark:text-white leading-none">المدير</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">مدير النظام</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
