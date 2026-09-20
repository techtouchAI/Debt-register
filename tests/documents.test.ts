import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/db';
import {
  buildCustomerStatementPrintHtml,
  buildInvoicePrintHtml,
  buildPrintDocument,
  buildReceiptPrintHtml
} from '@/lib/print';
import type { Customer, Invoice, InvoiceItem, Payment } from '@/types';

const settings = { ...DEFAULT_SETTINGS, officeName: 'مكتب الاختبار', phone: '0700000000', address: 'بغداد' };

const invoice: Invoice = {
  invoiceNumber: 'INV-1',
  type: 'credit',
  customerId: 1,
  customerName: 'زبون اختبار',
  itemsCount: 1,
  subtotal: 10000,
  discount: 1000,
  total: 9000,
  paidAmount: 4000,
  remaining: 5000,
  date: '2026-09-20T09:00:00.000Z',
  createdAt: '2026-09-20T09:00:00.000Z',
  status: 'partial'
};

const items: InvoiceItem[] = [
  { invoiceId: 1, materialId: 1, materialName: 'سماد يوريا', quantity: 2, unitPrice: 5000, total: 10000 }
];

describe('قوالب المستندات', () => {
  it('يبني فاتورة بتخطيط ثابت وأرقام لا تنكسر', () => {
    const html = buildInvoicePrintHtml(invoice, items, settings);
    expect(html).toContain('INV-1');
    expect(html).toContain('سماد يوريا');
    expect(html).toContain('colgroup');
    // ورقة الأنماط المشتركة تفرض التخطيط الثابت ومنع انكسار الأرقام
    const doc = buildPrintDocument('INV-1', html);
    expect(doc).toContain('table-layout: fixed');
    expect(doc).toContain('white-space: nowrap');
    // الأرقام بفئة num (سطر واحد + اتجاه ltr)
    expect(html).toContain('class="c num"');
  });

  it('يهرّب محاولات XSS في أسماء الزبائن والمواد', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = buildInvoicePrintHtml(
      { ...invoice, customerName: evil },
      [{ ...items[0], materialName: evil }],
      { ...settings, officeName: evil }
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('يبني وصل قبض حرارياً وكشف حساب', () => {
    const payment: Payment = {
      customerId: 1,
      customerName: 'زبون اختبار',
      amount: 4000,
      date: '2026-09-20T09:00:00.000Z',
      method: 'cash',
      receiptNumber: 'REC-1',
      createdAt: '2026-09-20T09:00:00.000Z'
    };
    const receipt = buildReceiptPrintHtml(payment, settings, 5000);
    expect(receipt).toContain('REC-1');
    expect(receipt).toContain('وصل قبض');

    const customer: Customer = { fullName: 'زبون اختبار', createdAt: '', updatedAt: '' };
    const statement = buildCustomerStatementPrintHtml(customer, [invoice], [payment], settings, 5000);
    expect(statement).toContain('كشف حساب الزبون');
    expect(statement).toContain('INV-1');
  });

  it('يبني وثيقة كاملة صالحة للمعاينة والطباعة', () => {
    const doc = buildPrintDocument('فاتورة INV-1', '<div class="doc">x</div>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('dir="rtl"');
    expect(doc).toContain('<style>');
  });
});
