import { OfficeSettings, Invoice, InvoiceItem, Payment, Customer, Purchase, PurchaseItem } from '@/types';
import {
  buildEmbeddableDocument,
  buildInvoicePrintHtml,
  buildReceiptPrintHtml,
  buildCustomerStatementPrintHtml,
  buildPurchasePrintHtml
} from './print';
import { describeSavedLocation, saveFile } from './files';
import { formatLocalDateInput, sanitizeFileName } from './utils';
import { formatDocumentNumber } from './labels';

/**
 * توليد ملفات PDF من قوالب HTML نفسها المستخدمة في المعاينة والطباعة.
 *
 * لماذا الرسم (html2canvas) بدل نص jsPDF المباشر؟
 * خط jsPDF الافتراضي (helvetica) لا يدعم العربية إطلاقاً — كان النص العربي
 * يظهر مفككاً ومقلوباً في الملفات السابقة. الرسم من HTML يعطي عربية سليمة
 * تماماً ويضمن تطابق المعاينة والطباعة وملف PDF حرفياً (مصدر واحد للحقيقة).
 *
 * الحفظ يتم عبر خدمة الملفات الموحّدة: مشاركة/مستندات على أندرويد، صندوق
 * حفظ على ويندوز، تنزيل في المتصفح — بدل `doc.save` الذي لا يفعل شيئاً
 * داخل WebView.
 */

type PdfFormat = 'a4' | 'receipt80';

/**
 * مكتبتا الرسم وإنشاء المستند (≈ 780 ك.ب) تُحمَّلان عند أول حفظ مستند فقط،
 * لا عند إقلاع التطبيق — إقلاع أسرع بوضوح على هواتف أندرويد الضعيفة. الملفات
 * محلية داخل التطبيق فلا حاجة لإنترنت.
 */
async function loadPdfLibraries() {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  return { jsPDF, html2canvas };
}

const RENDER_WIDTH: Record<PdfFormat, number> = {
  a4: 794, // عرض A4 بالبكسل (96dpi)
  receipt80: 302 // عرض 80مم بالبكسل
};

async function waitForImages(root: HTMLElement, timeoutMs = 3000): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return;
  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          })
      )
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
}

async function renderHtmlToPdfBlob(bodyHtml: string, format: PdfFormat): Promise<Blob> {
  const { jsPDF, html2canvas } = await loadPdfLibraries();
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-12000px';
  container.style.top = '0';
  container.style.width = `${RENDER_WIDTH[format]}px`;
  container.style.background = '#ffffff';
  container.style.padding = format === 'a4' ? '24px' : '8px';
  container.setAttribute('aria-hidden', 'true');
  container.innerHTML = buildEmbeddableDocument(bodyHtml);
  document.body.appendChild(container);

  try {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
      ]);
    } catch {
      /* الخطوط غير حرجة — نتابع بالبدائل */
    }
    await waitForImages(container);

    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });

    if (format === 'receipt80') {
      // صفحة حرارية واحدة بارتفاع ديناميكي حسب المحتوى
      const widthMm = 80;
      const heightMm = Math.min(500, Math.max(60, (canvas.height * widthMm) / canvas.width));
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [widthMm, heightMm] });
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMm, heightMm);
      const blob = doc.output('blob');
      return blob as Blob;
    }

    // A4 مع تقسيم ذكي لصفحات متعددة عند الحاجة
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const pxPerPage = Math.floor(canvas.width * (pageHeightMm / pageWidthMm));

    let renderedPx = 0;
    let firstPage = true;
    while (renderedPx < canvas.height) {
      const sliceHeight = Math.min(pxPerPage, canvas.height - renderedPx);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('تعذّر تجهيز صفحة المستند');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (!firstPage) doc.addPage();
      doc.addImage(
        slice.toDataURL('image/png'),
        'PNG',
        0,
        0,
        pageWidthMm,
        (sliceHeight * pageWidthMm) / canvas.width
      );
      firstPage = false;
      renderedPx += sliceHeight;
    }

    return doc.output('blob') as Blob;
  } finally {
    container.remove();
  }
}

/** نتيجة حفظ مستند: اسم الملف ووصف عربي لمكانه (لرسالة النجاح). */
export interface SavedDocument {
  fileName: string;
  message: string;
}

/**
 * حفظ المستند عبر خدمة الملفات الموحّدة.
 * @returns null إذا ألغى المستخدم صندوق الحفظ (لا رسالة نجاح كاذبة).
 */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle: string): Promise<SavedDocument | null> {
  const safeName = sanitizeFileName(fileName, 'مستند') + '.pdf';
  const result = await saveFile({
    fileName: safeName,
    mimeType: 'application/pdf',
    data: blob,
    shareTitle
  });
  if (!result.ok) {
    if (result.error === 'CANCELLED') return null;
    throw new Error(result.error || 'تعذّر حفظ المستند');
  }
  return { fileName: safeName, message: describeSavedLocation(result, safeName) };
}

export async function generateInvoicePDF(
  invoice: Invoice,
  items: InvoiceItem[],
  settings: OfficeSettings,
  _customer?: Customer
): Promise<SavedDocument | null> {
  void _customer;
  const blob = await renderHtmlToPdfBlob(buildInvoicePrintHtml(invoice, items, settings), 'a4');
  const number = formatDocumentNumber(invoice.invoiceNumber);
  return savePdfBlob(blob, `فاتورة_${number}_${invoice.customerName}`, `فاتورة ${number}`);
}

export async function generateReceiptPDF(
  payment: Payment,
  settings: OfficeSettings,
  customerDebtAfter?: number
): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(buildReceiptPrintHtml(payment, settings, customerDebtAfter), 'receipt80');
  const number = formatDocumentNumber(payment.receiptNumber);
  return savePdfBlob(blob, `وصل_قبض_${number}_${payment.customerName}`, `وصل قبض ${number}`);
}

export async function generateCustomerStatementPDF(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(
    buildCustomerStatementPrintHtml(customer, invoices, payments, settings, totalDebt),
    'a4'
  );
  const fileName = `كشف_حساب_${customer.fullName}_${formatLocalDateInput()}`;
  return savePdfBlob(blob, fileName, `كشف حساب ${customer.fullName}`);
}

export async function generatePurchasePDF(
  purchase: Purchase,
  items: PurchaseItem[],
  settings: OfficeSettings
): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(buildPurchasePrintHtml(purchase, items, settings), 'a4');
  const number = formatDocumentNumber(purchase.purchaseNumber);
  return savePdfBlob(blob, `وصل_شراء_${number}_${purchase.supplierName}`, `وصل شراء ${number}`);
}

/** توليد PDF من أي مستند مبني مسبقاً (للمسودات والمعاينات). */
export async function generatePdfFromBodyHtml(
  bodyHtml: string,
  fileName: string,
  shareTitle: string,
  format: PdfFormat = 'a4'
): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(bodyHtml, format);
  return savePdfBlob(blob, fileName, shareTitle);
}
