export interface OfficeSettings {
  id?: number;
  officeName: string;
  phone: string;
  address: string;
  logo?: string; // base64
  currency: string;
  lowStockThreshold: number;
  theme: 'light' | 'dark' | 'auto';
  autoBackupEnabled: boolean;
  autoBackupInterval: number; // minutes
  lastBackup?: string;
  language: string;
  invoiceFooter?: string;
  taxNumber?: string;
}

export interface User {
  id?: number;
  name: string;
  role: 'admin' | 'sales';
  pin: string;
  createdAt: string;
  lastLogin?: string;
}

export interface Material {
  id?: number;
  name: string;
  quantity: number;
  salePrice: number;
  purchasePrice?: number;
  category?: string;
  barcode?: string;
  minQuantity: number;
  unit?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id?: number;
  fullName: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id?: number;
  invoiceNumber: string;
  type: 'cash' | 'credit';
  customerId?: number;
  customerName: string;
  itemsCount: number;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  remaining: number;
  date: string;
  createdAt: string;
  notes?: string;
  status: 'paid' | 'partial' | 'unpaid';
}

export interface InvoiceItem {
  id?: number;
  invoiceId: number;
  materialId: number;
  materialName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  purchasePrice?: number;
}

export interface Payment {
  id?: number;
  customerId: number;
  customerName: string;
  amount: number;
  date: string;
  method: 'cash' | 'transfer' | 'other';
  receiptNumber: string;
  remainingAfter?: number;
  notes?: string;
  createdAt: string;
}

export interface Notification {
  id?: number;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  isRead: boolean;
  createdAt: string;
  relatedId?: number;
  relatedType?: 'material' | 'customer' | 'invoice' | 'payment' | 'system';
}

export interface ActivityLog {
  id?: number;
  action: string;
  details: string;
  timestamp: string;
  entityType?: string;
  entityId?: number;
}

export interface BackupMeta {
  id?: number;
  fileName: string;
  date: string;
  size?: number;
  type: 'auto' | 'manual' | 'import';
}

export interface CustomerDebtInfo {
  customer: Customer;
  totalInvoices: number;
  totalDebt: number;
  totalPaid: number;
  remainingDebt: number;
  lastInvoiceDate?: string;
  lastPaymentDate?: string;
}

export interface DailyCashReport {
  date: string;
  cashInvoicesTotal: number;
  paymentsTotal: number;
  total: number;
  cashInvoicesCount: number;
  paymentsCount: number;
}

export interface MaterialMovement {
  materialId: number;
  materialName: string;
  totalSold: number;
  totalRevenue: number;
  totalProfit?: number;
  sales: { invoiceId: number; customerName: string; quantity: number; date: string; total: number }[];
  currentStock: number;
}
