import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/db';
import {
  buildCustomerStatementPrintHtml,
  buildInvoicePrintHtml,
  buildPrintDocument,
  buildPurchasePrintHtml,
  buildReceiptPrintHtml
} from '@/lib/print';
import type { Customer, Invoice, InvoiceItem, Payment, Purchase, PurchaseItem } from '@/types';

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
    // الرقم القديم (INV-1) يُطبع بالبادئة العربية المقابلة مع الأرقام نفسها
    expect(html).toContain('ف-1');
    expect(html).not.toContain('INV-1');
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
    expect(receipt).toContain('ق-1');
    expect(receipt).not.toContain('REC-1');
    expect(receipt).toContain('نقدي');
    expect(receipt).toContain('وصل قبض');

    const customer: Customer = { fullName: 'زبون اختبار', createdAt: '', updatedAt: '' };
    const statement = buildCustomerStatementPrintHtml(customer, [invoice], [payment], settings, 5000);
    expect(statement).toContain('كشف حساب الزبون');
    expect(statement).toContain('ف-1');
    expect(statement).toContain('ق-1');
  });

  it('يبني وصل شراء بنفس قالب الطباعة والمعاينة', () => {
    const purchase: Purchase = {
      purchaseNumber: 'PUR-1',
      supplierName: 'مورد الاختبار',
      itemsCount: 1,
      subtotal: 12000,
      discount: 0,
      total: 12000,
      date: '2026-09-20T09:00:00.000Z',
      createdAt: '2026-09-20T09:00:00.000Z',
      paymentMethod: 'cash',
      paidAmount: 12000,
      remaining: 0
    };
    const purchaseItems: PurchaseItem[] = [{ purchaseId: 1, materialId: 1, materialName: 'مادة شراء', quantity: 2, purchasePrice: 6000, total: 12000 }];
    const html = buildPurchasePrintHtml(purchase, purchaseItems, settings);
    expect(html).toContain('ش-1');
    expect(html).not.toContain('PUR-1');
    expect(html).toContain('وصل شراء');
    expect(buildPrintDocument('PUR-1', html)).toContain('table-layout: fixed');
  });

  it('يطبع الرصيد السابق وإجمالي المطلوب على الفاتورة التي تحمل ديناً قديماً', () => {
    const previous = 3000;
    const carried = { ...invoice, previousBalance: previous };
    const html = buildInvoicePrintHtml(carried, items, settings);

    expect(html).toContain('الرصيد السابق');
    expect(html).toContain('إجمالي المطلوب');
    // المطلوب = قيمة الفاتورة + الدين القديم (منسّق كبقية الأرقام في المستند)
    expect(html).toContain((invoice.total + previous).toLocaleString('ar-IQ'));
    // المتبقي صار منسوباً صراحةً إلى هذه الفاتورة حتى لا يُلتبس بالمطلوب كاملاً
    expect(html).toContain('المتبقي على هذه الفاتورة');

    // فاتورة بلا دين قديم: لا تظهر سطور الرصيد السابق إطلاقاً
    const plain = buildInvoicePrintHtml(invoice, items, settings);
    expect(plain).not.toContain('الرصيد السابق');
    expect(plain).not.toContain('إجمالي المطلوب');
  });

  it('يبني وثيقة كاملة صالحة للمعاينة والطباعة', () => {
    const doc = buildPrintDocument('فاتورة INV-1', '<div class="doc">x</div>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('dir="rtl"');
    expect(doc).toContain('<style>');
  });
});
