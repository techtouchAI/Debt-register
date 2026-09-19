import Dexie, { Table } from 'dexie';
import { OfficeSettings, User, Material, Customer, Invoice, InvoiceItem, Payment, Notification as AppNotification, ActivityLog, BackupMeta } from '@/types';

export class AgriOfficeDB extends Dexie {
  settings!: Table<OfficeSettings>;
  users!: Table<User>;
  materials!: Table<Material>;
  customers!: Table<Customer>;
  invoices!: Table<Invoice>;
  invoiceItems!: Table<InvoiceItem>;
  payments!: Table<Payment>;
  notifications!: Table<AppNotification>;
  activityLogs!: Table<ActivityLog>;
  backups!: Table<BackupMeta>;

  constructor() {
    super('AgriOfficeDB');
    this.version(1).stores({
      settings: '++id',
      users: '++id, name, role',
      materials: '++id, name, category, quantity',
      customers: '++id, fullName, phone',
      invoices: '++id, invoiceNumber, customerId, type, date, customerName',
      invoiceItems: '++id, invoiceId, materialId',
      payments: '++id, customerId, date, receiptNumber',
      notifications: '++id, isRead, createdAt, relatedType',
      activityLogs: '++id, timestamp, entityType',
      backups: '++id, date'
    });
  }
}

export const db = new AgriOfficeDB();

// Initialize default settings
export async function initializeDB() {
  const settingsCount = await db.settings.count();
  if (settingsCount === 0) {
    await db.settings.add({
      officeName: 'المكتب الزراعي',
      phone: '',
      address: '',
      currency: 'د.ع',
      lowStockThreshold: 5,
      theme: 'light',
      autoBackupEnabled: true,
      autoBackupInterval: 60,
      language: 'ar',
      invoiceFooter: 'شكراً لتعاملكم معنا'
    });
  }

  const usersCount = await db.users.count();
  if (usersCount === 0) {
    await db.users.add({
      name: 'المدير',
      role: 'admin',
      pin: '1234',
      createdAt: new Date().toISOString()
    });
  }
}

// Helper functions
export async function getSettings(): Promise<OfficeSettings | undefined> {
  return await db.settings.toCollection().first();
}

export async function updateSettings(updates: Partial<OfficeSettings>) {
  const settings = await getSettings();
  if (settings?.id) {
    await db.settings.update(settings.id, { ...updates });
  }
}

export async function getCustomerDebt(customerId: number): Promise<number> {
  const invoices = await db.invoices.where('customerId').equals(customerId).toArray();
  const payments = await db.payments.where('customerId').equals(customerId).toArray();
  
  const creditInvoices = invoices.filter(inv => inv.type === 'credit');
  const totalDebt = creditInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = payments.reduce((sum, pay) => sum + pay.amount, 0);
  
  return totalDebt - totalPaid;
}

export async function getAllCustomersDebt(): Promise<{ customerId: number; debt: number }[]> {
  const customers = await db.customers.toArray();
  const result = [];
  for (const customer of customers) {
    if (customer.id) {
      const debt = await getCustomerDebt(customer.id);
      result.push({ customerId: customer.id, debt });
    }
  }
  return result;
}

export async function generateInvoiceNumber(): Promise<string> {
  const count = await db.invoices.count();
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
}

export async function generateReceiptNumber(): Promise<string> {
  const count = await db.payments.count();
  const date = new Date();
  const year = date.getFullYear();
  return `REC-${year}-${String(count + 1).padStart(5, '0')}`;
}

export async function logActivity(action: string, details: string, entityType?: string, entityId?: number) {
  await db.activityLogs.add({
    action,
    details,
    timestamp: new Date().toISOString(),
    entityType,
    entityId
  });
}

export async function createNotification(title: string, message: string, type: AppNotification['type'] = 'info', relatedId?: number, relatedType?: AppNotification['relatedType']) {
  await db.notifications.add({
    title,
    message,
    type,
    isRead: false,
    createdAt: new Date().toISOString(),
    relatedId,
    relatedType
  });

  // Try to show system notification (works in Windows and Android via WebView)
  try {
    if ('Notification' in window && window.Notification.permission === 'granted') {
      new window.Notification(title, { body: message, icon: '/pwa-192x192.png' } as any);
    } else if ('Notification' in window && window.Notification.permission !== 'denied') {
      const permission = await window.Notification.requestPermission();
      if (permission === 'granted') {
        new window.Notification(title, { body: message, icon: '/pwa-192x192.png' } as any);
      }
    }
    
    // Try Electron notification
    if ((window as any).electronAPI?.showNotification) {
      await (window as any).electronAPI.showNotification(title, message);
    }
    
    // Capacitor Local Notifications for Android - via Plugins API without static import
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap?.Plugins?.LocalNotifications) {
      try {
        await cap.Plugins.LocalNotifications.schedule({
          notifications: [{
            title,
            body: message,
            id: Date.now() % 100000,
            schedule: { at: new Date(Date.now() + 100) }
          }]
        });
      } catch {}
    }
  } catch (e) {
    console.log('Notification error:', e);
  }
}

export async function checkLowStock() {
  const settings = await getSettings();
  const threshold = settings?.lowStockThreshold || 5;
  const lowStockMaterials = await db.materials.where('quantity').belowOrEqual(threshold).toArray();
  
  for (const material of lowStockMaterials) {
    const existing = await db.notifications
      .where('relatedId').equals(material.id!)
      .filter(n => n.relatedType === 'material' && !n.isRead && n.title.includes('نفاد'))
      .first();
    
    if (!existing) {
      await createNotification(
        'تنبيه نفاد المخزون',
        `المادة "${material.name}" أوشكت على النفاد. الكمية المتبقية: ${material.quantity}`,
        'warning',
        material.id,
        'material'
      );
    }
  }
  return lowStockMaterials;
}
