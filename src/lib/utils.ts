import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = 'د.ع'): string {
  return `${amount.toLocaleString('ar-IQ')} ${currency}`;
}

export function formatDate(dateString: string, includeTime: boolean = false): string {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    calendar: 'gregory'
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleDateString('ar-EG', options);
}

export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG');
}

export function formatDateInput(date: Date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function calculateProfit(salePrice: number, purchasePrice: number | undefined, quantity: number): number {
  if (!purchasePrice) return 0;
  return (salePrice - purchasePrice) * quantity;
}

export function getStockStatus(quantity: number, minQuantity: number): 'out' | 'low' | 'normal' {
  if (quantity <= 0) return 'out';
  if (quantity <= minQuantity) return 'low';
  return 'normal';
}

export function getStockStatusColor(status: 'out' | 'low' | 'normal'): string {
  switch (status) {
    case 'out': return 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'low': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    case 'normal': return 'text-green-600 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
  }
}

export function getStockStatusText(status: 'out' | 'low' | 'normal'): string {
  switch (status) {
    case 'out': return 'نفد المخزون';
    case 'low': return 'مخزون منخفض';
    case 'normal': return 'متوفر';
  }
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
}
