import { useEffect, useState } from 'react';
// HashRouter: يعمل تحت file:// و WebView دون كسر pushState (سبب الشاشة السوداء السابق)
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Database, RefreshCw } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Toaster } from '@/components/ui/Toaster';
import { Button } from '@/components/ui/button';
import { FirstRunSetup } from '@/components/setup/FirstRunSetup';
import { NativeBackButton } from '@/components/NativeBackButton';
import { Dashboard } from '@/pages/Dashboard';
import { Materials } from '@/pages/Materials';
import { Customers } from '@/pages/Customers';
import { Invoices } from '@/pages/Invoices';
import { InvoiceForm } from '@/pages/InvoiceForm';
import { InvoiceView } from '@/pages/InvoiceView';
import { Payments } from '@/pages/Payments';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { Backup } from '@/pages/Backup';
import { Notifications } from '@/pages/Notifications';
import { CustomerStatement } from '@/pages/CustomerStatement';
import { checkStorageAvailable, getSettings, initializeDB } from '@/lib/db';
import { setupAutoBackup } from '@/lib/backup';
import { runStartupMaintenance } from '@/lib/maintenance';
import { installGlobalErrorHandlers, reportError } from '@/lib/errors';
import { initSystemNotifications } from '@/lib/notify';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'storage-error'; error: string };

function StorageErrorScreen({ error }: { error: string }) {
  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-cairo"
    >
      <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-red-200 dark:border-red-900/50 p-6 text-center">
        <Database className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">تعذّر فتح قاعدة البيانات المحلية</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
          يحتاج التطبيق إلى التخزين المحلي (IndexedDB) لحفظ الفواتير والديون. لم نتمكن من الكتابة فيه الآن.
        </p>
        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mb-4">
          {error}
        </p>
        <ul className="text-xs text-gray-600 dark:text-gray-300 text-right space-y-1 mb-5 list-disc pr-5">
          <li>أغلق وضع التصفح الخاص (الخفي) وافتح التطبيق في نافذة عادية.</li>
          <li>تأكد من السماح للموقع/التطبيق باستخدام التخزين من إعدادات المتصفح.</li>
          <li>إذا كانت المساحة ممتلئة، احذف بعض الملفات أو النسخ الاحتياطية القديمة.</li>
          <li>لا تغلق جميع نوافذ التطبيق أثناء تحديث قاعدة البيانات.</li>
        </ul>
        <Button onClick={() => window.location.reload()} className="bg-primary-600 hover:bg-primary-700">
          <RefreshCw className="w-4 h-4 ml-2" />
          إعادة المحاولة
        </Button>
      </div>
    </div>
  );
}

function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  // معالج التشغيل الأول: يظهر عندما لا يوجد اسم مكتب مُدخل (تثبيت جديد
  // أو نسخة مستوردة بلا اسم) — لا يُكتب أي اسم تلقائياً.
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    installGlobalErrorHandlers();

    let stopAutoBackup: (() => void) | undefined;
    let cancelled = false;

    const init = async () => {
      const storage = await checkStorageAvailable();
      if (!storage.ok) {
        if (!cancelled) setBoot({ status: 'storage-error', error: storage.error ?? 'سبب غير معروف' });
        return;
      }

      try {
        await initializeDB();
        await runStartupMaintenance();
        stopAutoBackup = setupAutoBackup();
        await initSystemNotifications();

        const settings = await getSettings();
        if (!cancelled && !settings?.officeName?.trim()) {
          setNeedsSetup(true);
        }
      } catch (error) {
        reportError('app.init', error, 'تعذّر تهيئة التطبيق');
      }

      if (!cancelled) setBoot({ status: 'ready' });
    };

    void init();

    return () => {
      cancelled = true;
      stopAutoBackup?.();
    };
  }, []);

  if (boot.status === 'storage-error') return <StorageErrorScreen error={boot.error} />;

  if (boot.status === 'loading') {
    return (
      <div
        dir="rtl"
        className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-900 font-cairo"
      >
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 dark:text-gray-400">جاري تحميل بيانات المكتب…</p>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div dir="rtl" className="font-cairo">
        <FirstRunSetup onDone={() => setNeedsSetup(false)} />
        <Toaster />
      </div>
    );
  }

  return (
    <Router>
      <NativeBackButton />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerStatement />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/new" element={<InvoiceForm />} />
          <Route path="/invoices/:id" element={<InvoiceView />} />
          <Route path="/invoices/:id/edit" element={<InvoiceForm />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/payments/new" element={<Payments />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <Toaster />
    </Router>
  );
}

export default App;
