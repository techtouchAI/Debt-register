import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Materials } from '@/pages/Materials';
import { Customers } from '@/pages/Customers';
import { Invoices } from '@/pages/Invoices';
import { InvoiceForm } from '@/pages/InvoiceForm';
import { Payments } from '@/pages/Payments';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { Backup } from '@/pages/Backup';
import { Notifications } from '@/pages/Notifications';
import { CustomerStatement } from '@/pages/CustomerStatement';
import { initializeDB } from '@/lib/db';
import { setupAutoBackup } from '@/lib/backup';

function App() {
  useEffect(() => {
    const init = async () => {
      await initializeDB();
      setupAutoBackup();
      
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      // Register service worker for PWA
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/sw.js');
        } catch (e) {
          console.log('SW registration failed', e);
        }
      }
    };
    init();
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerStatement />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/new" element={<InvoiceForm />} />
          <Route path="/invoices/:id" element={<InvoiceForm />} />
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
    </Router>
  );
}

export default App;
