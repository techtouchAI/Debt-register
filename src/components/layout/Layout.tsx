import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  FileText, 
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
import { db, getSettings, countUnreadNotifications } from '@/lib/db';
import { reportError } from '@/lib/errors';
import { useLiveQuery } from 'dexie-react-hooks';
import { OfficeSettings } from '@/types';

interface LayoutProps {
  children: React.ReactNode;
}

const navigation = [
  { name: 'لوحة التحكم', href: '/', icon: LayoutDashboard },
  { name: 'المخزن والمواد', href: '/materials', icon: Package },
  { name: 'العملاء', href: '/customers', icon: Users },
  { name: 'الفواتير', href: '/invoices', icon: FileText },
  { name: 'التسديدات', href: '/payments', icon: CreditCard },
  { name: 'التقارير', href: '/reports', icon: BarChart3 },
  { name: 'النسخ الاحتياطي', href: '/backup', icon: Database },
  { name: 'الإعدادات', href: '/settings', icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [isDark, setIsDark] = useState(false);
  const location = useLocation();

  const unreadNotifications = useLiveQuery(() => countUnreadNotifications(), []) || 0;
  const lowStockCount = useLiveQuery(async () => {
    const s = await getSettings();
    const threshold = s?.lowStockThreshold || 5;
    return await db.materials.where('quantity').belowOrEqual(threshold).count();
  }, []) || 0;

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const s = await getSettings();
        if (!cancelled && s) setSettings(s);
      } catch (error) {
        if (!cancelled) reportError('Layout.settings', error, 'تعذّر تحميل الإعدادات');
      }
    };

    void loadSettings();

    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      }
    } catch {
      /* التخزين المحلي غير متاح */
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    document.documentElement.classList.toggle('dark', newTheme);
    try {
      localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    } catch {
      /* التخزين المحلي غير متاح */
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 font-cairo">
      {/* Sidebar - Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 right-0 z-50 w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-20 px-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              {settings?.logo ? (
                <img src={settings.logo} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-xl">
                  م
                </div>
              )}
              <div>
                <h1 className="font-bold text-gray-900 dark:text-white text-sm leading-tight">{settings?.officeName || 'المكتب الزراعي'}</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">إدارة متكاملة</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
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
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <div className="bg-gradient-to-br from-primary-50 to-green-50 dark:from-primary-900/20 dark:to-green-900/20 rounded-xl p-4 border border-primary-100 dark:border-primary-800/30">
              <p className="text-xs font-medium text-primary-800 dark:text-primary-300">نظام بدون انترنت</p>
              <p className="text-[11px] text-primary-600 dark:text-primary-400 mt-1">جميع البيانات محفوظة محلياً وآمنة</p>
            </div>
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
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="w-5 h-5" />
              </Button>
              <div className="hidden lg:block">
                <h2 className="font-bold text-gray-900 dark:text-white">
                  {navigation.find(n => n.href === location.pathname || (n.href !== '/' && location.pathname.startsWith(n.href)))?.name || 'لوحة التحكم'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
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
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-green-600 flex items-center justify-center text-white font-bold text-sm">
                  م
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
