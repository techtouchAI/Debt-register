import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentPreviewHost } from '@/components/documents/DocumentPreviewHost';
import { closeDocumentPreview, getActiveDocumentPreview, openDocumentPreview } from '@/lib/documentPreview';
import { buildPrintDocument, invoiceDocument, receiptDocument } from '@/lib/print';
import type { Invoice, InvoiceItem, OfficeSettings, Payment } from '@/types';

const settings: OfficeSettings = { officeName: 'مكتب الاختبار', phone: '0700000000', address: 'الحلة', currency: 'د.ع', lowStockThreshold: 5, theme: 'light', autoBackupEnabled: false, autoBackupInterval: 60, language: 'ar' };
const invoice: Invoice = { id: 1, invoiceNumber: 'ف-1', type: 'cash', customerName: 'زبون', itemsCount: 1, subtotal: 1000, discount: 0, total: 1000, paidAmount: 1000, remaining: 0, date: '2026-09-20T09:00:00.000Z', createdAt: '2026-09-20T09:00:00.000Z', status: 'paid' };
const item: InvoiceItem = { id: 1, invoiceId: 1, materialId: 1, materialName: 'مادة', quantity: 1, unitPrice: 1000, unitCost: 500, total: 1000 };
const payment: Payment = { id: 3, customerId: 1, customerName: 'زبون', amount: 1000, date: invoice.date, method: 'cash', receiptNumber: 'ق-3', createdAt: invoice.date };

describe('أوصاف المستندات', () => {
  it('يوحّد مقاس a4 للفاتورة ووصل القبض', () => {
    expect(invoiceDocument(invoice, [item], settings).pdfFormat).toBe('a4');
    expect(receiptDocument(payment, settings).pdfFormat).toBe('a4');
  });

  it('هيكل المعاينة والطباعة يستخدم ورقة A4 نفسها', () => {
    const html = buildPrintDocument('اختبار', '<div class="doc"><div class="page">محتوى</div></div>', { view: 'preview', fitWidthPx: 600 });
    expect(html).toContain('width: 210mm');
    expect(html).toContain('@page { size: A4');
    expect(html).not.toContain('80mm');
  });
});

describe('مضيف المعاينة', () => {
  it('يعرض الوثيقة على ورقة A4 ويغلق بزر Escape', async () => {
    render(<DocumentPreviewHost />);
    openDocumentPreview({ title: 'وصل قبض ق-3', bodyHtml: receiptDocument(payment, settings).bodyHtml, fileNameBase: 'وصل', pdfFormat: 'a4' });
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    const frame = within(dialog).getByTitle('وصل قبض ق-3');
    expect(frame.getAttribute('srcdoc')).toContain('width: 210mm');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getActiveDocumentPreview()).toBeNull();
    cleanup();
  });

  it('لا يقبل الوصف أي مقاس آخر', () => {
    openDocumentPreview({ title: 'فاتورة', bodyHtml: '<p>اختبار</p>', fileNameBase: 'فاتورة', pdfFormat: 'a4' });
    expect(getActiveDocumentPreview()?.pdfFormat).toBe('a4');
    closeDocumentPreview();
  });
});
