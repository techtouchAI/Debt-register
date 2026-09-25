import { describe, expect, it } from 'vitest';
import { buildCustomerStatementPrintHtml, buildInvoicePrintHtml, buildPrintDocument, buildReceiptPrintHtml, invoiceDocument, receiptDocument } from '@/lib/print';
import type { Customer, Invoice, InvoiceItem, OfficeSettings, Payment } from '@/types';

const settings: OfficeSettings = { officeName: 'مكتب الاختبار', phone: '0700000000', address: 'الحلة', currency: 'د.ع', lowStockThreshold: 5, theme: 'light', autoBackupEnabled: false, autoBackupInterval: 60, language: 'ar', invoiceFooter: 'شكراً لتعاملكم معنا' };
const invoice: Invoice = { id: 1, invoiceNumber: 'ف-1', type: 'credit', customerId: 1, customerName: 'زبون اختبار', itemsCount: 1, subtotal: 10000, discount: 0, total: 10000, paidAmount: 0, remaining: 10000, date: '2026-09-20T09:00:00.000Z', createdAt: '2026-09-20T09:00:00.000Z', status: 'unpaid' };
const items: InvoiceItem[] = [{ id: 1, invoiceId: 1, materialId: 1, materialName: 'مادة اختبار', quantity: 2, unitPrice: 5000, unitCost: 3000, total: 10000 }];
const payment: Payment = { id: 3, customerId: 1, customerName: 'زبون اختبار', amount: 4000, date: '2026-09-20T09:00:00.000Z', method: 'cash', receiptNumber: 'ق-3', createdAt: '2026-09-20T09:00:00.000Z' };

describe('قوالب المستندات القياسية', () => {
  it('يبني فاتورة بتخطيط ثابت وأرقام لا تنكسر', () => {
    const html = buildInvoicePrintHtml(invoice, items, settings);
    expect(html).toContain('فاتورة');
    expect(html).toContain('مادة اختبار');
    expect(html).toContain('class="num"');
    expect(html).toContain('class="grid"');
  });

  it('يهرّب محاولات الحقن في أسماء الزبائن والمواد', () => {
    const html = buildInvoicePrintHtml({ ...invoice, customerName: '<script>alert(1)</script>' }, [{ ...items[0], materialName: '<img src=x>' }], settings);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('يبني وصل القبض وكشف الحساب على ورقة قياسية واحدة', () => {
    const receipt = buildReceiptPrintHtml(payment, settings, 6000);
    const customer: Customer = { id: 1, fullName: 'زبون اختبار', createdAt: invoice.createdAt, updatedAt: invoice.createdAt };
    const statement = buildCustomerStatementPrintHtml(customer, [invoice], [payment], settings, 6000);
    expect(receipt).toContain('وصل قبض');
    expect(receipt).toContain('الدين المتبقي');
    expect(statement).toContain('كشف حساب');
    expect(buildPrintDocument('وصل', receipt)).toContain('width: 210mm');
  });

  it('كل أوصاف المستندات تصرّح بورقة a4 فقط', () => {
    expect(invoiceDocument(invoice, items, settings).pdfFormat).toBe('a4');
    expect(receiptDocument(payment, settings).pdfFormat).toBe('a4');
  });

  it('يبني وثيقة كاملة صالحة للمعاينة والطباعة', () => {
    const complete = buildPrintDocument('فاتورة اختبار', buildInvoicePrintHtml(invoice, items, settings), { view: 'preview', fitWidthPx: 600 });
    expect(complete).toContain('<!doctype html>');
    expect(complete).toContain('@page { size: A4');
  });
});
