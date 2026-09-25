import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  PRINT_FALLBACK_NOTICE,
  buildCustomerStatementPrintHtml,
  buildInvoicePrintHtml,
  buildPrintDocument,
  buildReceiptPrintHtml,
  invoiceDocument,
  printDocument,
  purchaseDocument,
  receiptDocument,
  statementDocument,
  systemPrintAvailable
} from '@/lib/print';
import { DEFAULT_SETTINGS } from '@/lib/db';
import {
  closeDocumentPreview,
  getActiveDocumentPreview,
  openDocumentPreview
} from '@/lib/documentPreview';
import { DocumentPreviewHost } from '@/components/documents/DocumentPreviewHost';
import type { Customer, Invoice, InvoiceItem, Payment, Purchase, PurchaseItem } from '@/types';

/**
 * مسارات المستند الثلاثة: معاينة + طباعة + حفظ.
 *
 * العلّة الأصلية: الضغط على «طباعة» لم يُظهر شيئاً إطلاقاً — `window.print`
 * داخل الإطار المخفي تُهمله بعض البيئات بصمت (بلا استثناء) وكان الكود يُبلّغ
 * بالنجاح، والويبهو داخل تطبيق أندرويد لا يملك حوار طباعة أصلاً. الاختبارات
 * هنا تثبّت أن كل ضغطة تنتهي بنتيجة مرئية: إمّا حوار طباعة النظام، وإمّا
 * نافذة المعاينة مع رسالة توضّح البديل.
 */

const settings = { ...DEFAULT_SETTINGS, officeName: 'مكتب الاختبار', phone: '0700000000', address: 'بغداد' };

const invoice: Invoice = {
  invoiceNumber: 'INV-7',
  type: 'credit',
  customerId: 1,
  customerName: 'زبون اختبار',
  itemsCount: 1,
  subtotal: 10000,
  discount: 0,
  total: 10000,
  paidAmount: 0,
  remaining: 10000,
  previousBalance: 4000,
  date: '2026-09-20T09:00:00.000Z',
  createdAt: '2026-09-20T09:00:00.000Z',
  status: 'unpaid'
};

const items: InvoiceItem[] = [{ invoiceId: 1, materialId: 1, materialName: 'سماد يوريا', quantity: 2, unitPrice: 5000, total: 10000 }];

const payment: Payment = {
  customerId: 1,
  customerName: 'زبون اختبار',
  amount: 4000,
  date: '2026-09-20T09:00:00.000Z',
  method: 'cash',
  receiptNumber: 'REC-3',
  createdAt: '2026-09-20T09:00:00.000Z'
};

const customer: Customer = { fullName: 'زبون اختبار', createdAt: '', updatedAt: '' };

afterEach(() => {
  closeDocumentPreview();
  cleanup();
  delete window.Capacitor;
  delete window.electronAPI;
});

describe('أوصاف المستندات', () => {
  it('توصيف واحد لكل مستند يحمل العنوان واسم الملف ومقاس الورقة', () => {
    const sale = invoiceDocument(invoice, items, settings);
    expect(sale.title).toContain('ف-7');
    expect(sale.fileNameBase).toContain('فاتورة_ف-7');
    expect(sale.pdfFormat).toBe('a4');

    const receipt = receiptDocument(payment, settings, 6000);
    expect(receipt.title).toContain('ق-3');
    expect(receipt.fileNameBase).toContain('وصل_قبض_ق-3');
    // الوصل يُحفظ على ورقته الحرارية لا على A4
    expect(receipt.pdfFormat).toBe('receipt80');

    const statement = statementDocument(customer, [invoice], [payment], settings, 14000);
    expect(statement.title).toContain('زبون اختبار');
    expect(statement.bodyHtml).toContain('كشف حساب الزبون');

    const purchase: Purchase = {
      purchaseNumber: 'PUR-2',
      supplierName: 'مورد الاختبار',
      itemsCount: 1,
      subtotal: 5000,
      discount: 0,
      total: 5000,
      date: '2026-09-20T09:00:00.000Z',
      createdAt: '2026-09-20T09:00:00.000Z',
      paymentMethod: 'cash',
      paidAmount: 5000,
      remaining: 0
    };
    const purchaseItems: PurchaseItem[] = [{ purchaseId: 1, materialId: 1, materialName: 'مادة', quantity: 1, purchasePrice: 5000, total: 5000 }];
    const order = purchaseDocument(purchase, purchaseItems, settings);
    expect(order.title).toContain('ش-2');
    expect(order.bodyHtml).toContain('وصل شراء');
  });

  it('جسم المستند هو نفسه في المعاينة والطباعة والحفظ (لا تباين بين المسارات)', () => {
    const descriptor = invoiceDocument(invoice, items, settings);
    expect(descriptor.bodyHtml).toBe(buildInvoicePrintHtml(invoice, items, settings));
    expect(receiptDocument(payment, settings).bodyHtml).toBe(buildReceiptPrintHtml(payment, settings));
  });
});

describe('هندسة وثيقة العرض', () => {
  it('ورقة المستند مقاساتها بالملّيمتر لا بالبكسل', () => {
    const documentHtml = buildPrintDocument('فاتورة', invoiceDocument(invoice, items, settings).bodyHtml);
    expect(documentHtml).toContain('width: 210mm');
    expect(documentHtml).toContain('min-height: 297mm');
    expect(documentHtml).toContain('padding: 10mm');
    expect(documentHtml).toContain('@page { size: A4; margin: 10mm; }');
    // الوصل الحراري يرسم ورقته بعرض 80مم
    expect(buildPrintDocument('وصل', receiptDocument(payment, settings).bodyHtml)).toContain('width: 80mm');
  });

  it('هيكل المعاينة (خلفية رمادية + تصغير) لا يدخل مستند الطباعة', () => {
    const body = invoiceDocument(invoice, items, settings).bodyHtml;
    const printDocumentHtml = buildPrintDocument('فاتورة', body);
    // العطل السابق: خلفية المعاينة الرمادية كانت تُطبع فعلاً فتبدو الهوامش مختلفة
    expect(printDocumentHtml).not.toContain('class="doc-view"');
    expect(printDocumentHtml).not.toContain('--doc-zoom:0.');

    const previewHtml = buildPrintDocument('فاتورة', body, { view: 'preview', fitWidthPx: 360 });
    expect(previewHtml).toContain('class="doc-view"');
    expect(previewHtml).toContain('--doc-zoom:0.4');
    // ومع ذلك تُطبع الورقة بلا خلفية المعاينة
    expect(previewHtml).toContain('.doc-view { background: #fff !important; padding: 0 !important; }');
  });
});

describe('زر الطباعة لا ينتهي بلا أثر', () => {
  it('في الويب: يُنتظر دليل حوار الطباعة فلا يُعلن النجاح كذباً', async () => {
    // jsdom لا يشغّل حواراً ولا يُطلق beforeprint ⇒ النتيجة «محجوب»
    expect(systemPrintAvailable()).toBe(true);
    const outcome = await printDocument(invoiceDocument(invoice, items, settings));
    expect(outcome).toBe('blocked');
    // وبدل الصمت تُفتح المعاينة مع رسالة البديل
    const request = getActiveDocumentPreview();
    expect(request).not.toBeNull();
    expect(request?.notice).toBe(PRINT_FALLBACK_NOTICE.blocked);
    expect(request?.title).toContain('ف-7');
  });

  it('في تطبيق ويندوز (Electron) تُستخدم نافذة الطباعة الأصلية لا window.print', async () => {
    // Electron لا ينفّذ window.print إطلاقاً: الجسر هو الوسيلة الوحيدة
    let received: { html: string; title?: string } | null = null;
    window.electronAPI = {
      isElectron: true,
      printDocument: async (html, title) => {
        received = { html, title };
        return { success: true };
      }
    };

    expect(systemPrintAvailable()).toBe(true);
    const outcome = await printDocument(invoiceDocument(invoice, items, settings));
    expect(outcome).toBe('printed');
    // المستند المُرسل للطباعة هو وثيقة الطباعة نفسها (ورقة A4 وهوامش @page)
    expect(received?.html).toContain('@page { size: A4; margin: 10mm; }');
    expect(received?.html).not.toContain('class="doc-view"');
    // ولا تُفتح معاينة بديلة عند نجاح الطباعة
    expect(getActiveDocumentPreview()).toBeNull();
  });

  it('إن رفض النظام الطباعة على ويندوز تُعرض المعاينة مع البديل', async () => {
    window.electronAPI = {
      isElectron: true,
      printDocument: async () => ({ success: false, error: 'لا توجد طابعة مثبتة' })
    };
    const outcome = await printDocument(invoiceDocument(invoice, items, settings));
    expect(outcome).toBe('blocked');
    expect(getActiveDocumentPreview()?.notice).toBe(PRINT_FALLBACK_NOTICE.blocked);
  });

  it('في تطبيق أندرويد/iPhone لا حوار طباعة: تُعرض المعاينة مع بديل الحفظ', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    expect(systemPrintAvailable()).toBe(false);

    const outcome = await printDocument(receiptDocument(payment, settings, 0));
    expect(outcome).toBe('unsupported');
    const request = getActiveDocumentPreview();
    expect(request?.notice).toBe(PRINT_FALLBACK_NOTICE.unsupported);
    expect(request?.pdfFormat).toBe('receipt80');
  });
});

describe('مضيف المعاينة', () => {
  it('يعرض المستند المحفوظ في المخزن ويُغلق بزر Escape عبر مكدس النوافذ', async () => {
    openDocumentPreview({
      title: 'وصل قبض ق-3',
      bodyHtml: receiptDocument(payment, settings).bodyHtml,
      fileNameBase: 'وصل_قبض_ق-3',
      pdfFormat: 'receipt80',
      notice: PRINT_FALLBACK_NOTICE.unsupported
    });

    render(<DocumentPreviewHost />);
    const dialog = await screen.findByRole('dialog', { name: 'وصل قبض ق-3' });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId('document-preview-notice').textContent).toContain('حوار طباعة في هذا الجهاز');

    // الإطار يعرض الورقة نفسها التي تُطبع (مقاسات بالملّيمتر)
    const frame = within(dialog).getByTitle('وصل قبض ق-3');
    expect(frame.getAttribute('srcdoc')).toContain('width: 80mm');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(getActiveDocumentPreview()).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('يُعرض الكشف بحاوية A4 كاملة', async () => {
    openDocumentPreview(statementDocument(customer, [invoice], [payment], settings, 14000));
    render(<DocumentPreviewHost />);
    const dialog = await screen.findByRole('dialog', { name: /كشف حساب/ });
    expect(dialog).toBeTruthy();
    expect(buildCustomerStatementPrintHtml(customer, [invoice], [payment], settings, 14000)).toContain('ف-7');
  });
});
