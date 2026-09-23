import { escapeHtml, formatDate } from './utils';
import { officeNameFontSize } from './officeName';
import type { Customer, Invoice, InvoiceItem, OfficeSettings, Payment, Purchase, PurchaseItem } from '@/types';

/**
 * مستندات الطباعة والمعاينة وملفات PDF.
 *
 * مبدأ التصميم: قالب HTML واحد لكل مستند يُستخدم في ثلاثة مسارات
 * (معاينة داخل التطبيق + طباعة + توليد PDF) حتى تكون المخرجات متطابقة
 * دائماً بدل ثلاثة تنسيقات مختلفة تتباين مع كل تعديل.
 *
 * الطباعة تتم عبر iframe مخفي (لا `window.open`):
 *  - النوافذ المنبثقة محظورة في WebView أندرويد ومرفوضة في Electron
 *    (setWindowOpenHandler يرفضها) فكانت الطباعة لا تعمل إطلاقاً هناك.
 *
 * كل قيمة ديناميكية تُهرَّب عبر escapeHtml لأن أسماء الزبائن والمواد
 * والملاحظات تُدخل يدوياً وقد تصل من ملف نسخة احتياطية مستورد؛ إدراجها
 * خاماً كان يسمح بتنفيذ شيفرة (XSS).
 */

/* ------------------------------------------------------------------ *
 * ورقة الأنماط المشتركة للمستندات
 *
 * قواعد منع خروج المحتوى (تُطبَّق على الفاتورة والوصل والكشف):
 *  - الجداول بعرض ثابت (table-layout: fixed) مع أعمدة بنِسَب محسوبة.
 *  - الأرقام والتواريخ والمبالغ: سطر واحد لا ينكسر أبداً (nowrap + ltr).
 *  - النصوص العربية: التفاف عند حدود الكلمات فقط (word-break: normal)،
 *    والكسر داخل الكلمة مسموح فقط للسلاسل الطويلة بلا مسافات حتى لا
 *    تخرج عن حد الخلية (overflow-wrap: break-word).
 *  - صفوف الجدول لا تنشطر بين صفحتين (break-inside: avoid).
 *  - أزواج (التسمية: القيمة) القصيرة لا تنفصل عن بعضها.
 * ------------------------------------------------------------------ */

const DOCUMENT_CSS = `
.doc { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; color: #111827; direction: rtl; line-height: 1.7; }
.doc * { box-sizing: border-box; }
.doc h1, .doc h2, .doc h3, .doc p { margin: 0; }
.doc .page { max-width: 770px; margin: 0 auto; background: #fff; }
.doc-header { text-align: center; border-bottom: 2px solid #8f7048; padding-bottom: 12px; margin-bottom: 14px; }
.doc-header h1 { color: #8f7048; font-size: 22px; line-height: 1.4; overflow-wrap: anywhere; word-break: normal; white-space: normal; }
.doc-header h1.office-name, .doc.receipt h2.office-name { display: block; overflow: visible; -webkit-line-clamp: unset; line-clamp: unset; }
.doc-header .sub { color: #6b7280; font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
.doc-header img { max-height: 60px; max-width: 180px; margin-top: 8px; object-fit: contain; }
.doc-meta { display: flex; flex-wrap: wrap; gap: 6px 24px; justify-content: space-between; margin-bottom: 14px; font-size: 13px; }
.doc-meta .col { min-width: 0; }
.doc-meta .pair { white-space: nowrap; }
.doc-meta .pair .v { font-weight: 700; }
.doc-meta .wrap { white-space: normal; word-break: normal; overflow-wrap: anywhere; }
.doc table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 14px; font-size: 13px; }
.doc table.grid th, .doc table.grid td { border: 1px solid #d1d5db; padding: 7px 8px; vertical-align: top; }
.doc table.grid thead th { background: #f0fdf4; font-size: 12.5px; }
.doc table.grid tbody tr { break-inside: avoid; page-break-inside: avoid; }
.doc table.grid td.name { word-break: normal; overflow-wrap: anywhere; }
.doc .num { white-space: nowrap; direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }
.doc .c { text-align: center; }
.doc .l { text-align: left; }
.doc .totals { text-align: left; border-top: 2px solid #8f7048; padding-top: 10px; font-size: 13px; }
.doc .totals p { white-space: nowrap; }
.doc .totals .grand { font-size: 17px; font-weight: 800; color: #8f7048; }
.doc .notes { margin-top: 10px; font-size: 12px; color: #4b5563; word-break: normal; overflow-wrap: anywhere; }
.doc .doc-footer { text-align: center; margin-top: 20px; padding-top: 10px; border-top: 1px dashed #d1d5db; color: #6b7280; font-size: 12px; }
.doc .section-title { font-size: 14px; font-weight: 800; margin: 0 0 6px; }
.doc .balance { font-size: 15px; font-weight: 800; white-space: nowrap; }
/* وصل حراري 80مم */
.doc.receipt .page { max-width: 300px; font-size: 13px; }
.doc.receipt h2 { font-size: 17px; }
.doc.receipt hr { border: 0; border-top: 1px dashed #9ca3af; margin: 10px 0; }
.doc.receipt .lines { text-align: right; line-height: 2; }
.doc.receipt .lines p { word-break: normal; overflow-wrap: anywhere; }
.doc.receipt .amount { font-size: 18px; font-weight: 800; color: #8f7048; white-space: nowrap; }
.doc.receipt .muted { color: #6b7280; font-size: 12px; }
@media print {
  body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc .page { max-width: none; }
}
@page { size: A4; margin: 10mm; }
`;

/**
 * ترويسة اسم المكتب.
 * الاسم يُطبع كاملاً دائماً؛ وإذا طال نصغّر الخط تدريجياً بدل أن يخرج عن
 * حدود الصفحة (يعمل مع الطباعة و PDF لأن الاثنين يستخدمان القالب نفسه).
 */
function officeNameHeading(settings: OfficeSettings, tag: 'h1' | 'h2' = 'h1'): string {
  const name = settings.officeName || '';
  const size = officeNameFontSize(name);
  const extra = tag === 'h1' ? '' : '; font-size:' + Math.max(14, size - 5) + 'px';
  return `<${tag} class="office-name doc-office-name" data-office-name="${escapeHtml(name)}" style="font-size:${size}px${extra}">${escapeHtml(name)}</${tag}>`;
}

export type DocumentKind = 'invoice' | 'receipt' | 'statement';

export interface BuiltDocument {
  kind: DocumentKind;
  title: string;
  /** نص الجسم فقط (يُستخدم داخل المعاينة/الطباعة/PDF) */
  bodyHtml: string;
}

/** وثيقة HTML كاملة وجاهزة (لـ iframe المعاينة/الطباعة). */
export function buildPrintDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body style="margin:0;padding:16px;background:#fff;">${bodyHtml}</body>
</html>`;
}

/** أنماط + جسم جاهزة للحقن داخل حاوية (لتوليد PDF عبر الرسم). */
export function buildEmbeddableDocument(bodyHtml: string): string {
  return `<style>${DOCUMENT_CSS}</style>${bodyHtml}`;
}

/* ------------------------------------------------------------------ *
 * الطباعة عبر iframe مخفي — تعمل في المتصفح وElectron وWebView
 * ------------------------------------------------------------------ */

function waitForIframeReady(iframe: HTMLIFrameElement, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = window.setTimeout(done, timeoutMs);
    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        // مهلة قصيرة لتحميل الصور (الشعار) قبل الطباعة
        window.setTimeout(done, 250);
      },
      { once: true }
    );
  });
}

/**
 * طباعة مستند HTML. تُعيد true عند فتح حوار الطباعة بنجاح.
 * في أندرويد الأصلي لا يوجد حوار طباعة داخل WebView — يُعيد false
 * ليستخدم المستدعي بديل PDF (حفظ/مشاركة) بدل إظهار لا شيء.
 */
export async function printHtmlDocument(title: string, bodyHtml: string): Promise<boolean> {
  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', title);
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return false;
    }

    doc.open();
    doc.write(buildPrintDocument(title, bodyHtml));
    doc.close();

    await waitForIframeReady(iframe);

    const frameWindow = iframe.contentWindow;
    if (!frameWindow || typeof frameWindow.print !== 'function') {
      iframe.remove();
      return false;
    }

    frameWindow.focus();
    frameWindow.print();

    // إزالة متأخرة حتى لا يُجهَض حوار الطباعة في بعض المتصفحات
    window.setTimeout(() => iframe.remove(), 2000);
    return true;
  } catch (error) {
    console.warn('تعذّر الطباعة:', error);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * قوالب المستندات
 * ------------------------------------------------------------------ */

export function buildInvoicePrintHtml(invoice: Invoice, items: InvoiceItem[], settings: OfficeSettings): string {
  const currency = escapeHtml(settings.currency || '');
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td class="c num">${index + 1}</td>
          <td class="name">${escapeHtml(item.materialName)}</td>
          <td class="c num">${escapeHtml(item.quantity)}</td>
          <td class="c num">${escapeHtml(item.unitPrice.toLocaleString('ar-IQ'))}</td>
          <td class="l num">${escapeHtml(item.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const statusText = invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة';

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" />` : ''}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="pair">رقم الفاتورة: <span class="v num">${escapeHtml(invoice.invoiceNumber)}</span></p>
          <p class="wrap">الزبون: <strong>${escapeHtml(invoice.customerName)}</strong></p>
          <p class="pair">النوع: <span class="v">${invoice.type === 'cash' ? 'نقدي' : 'آجل'}</span></p>
        </div>
        <div class="col">
          <p class="pair">التاريخ: <span class="v">${escapeHtml(formatDate(invoice.date, true))}</span></p>
          <p class="pair">الحالة: <span class="v">${statusText}</span></p>
        </div>
      </div>

      <table class="grid">
        <colgroup>
          <col style="width:8%" />
          <col style="width:42%" />
          <col style="width:13%" />
          <col style="width:17%" />
          <col style="width:20%" />
        </colgroup>
        <thead>
          <tr><th class="c">#</th><th>المادة</th><th class="c">الكمية</th><th class="c">السعر</th><th class="l">الإجمالي</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="c" style="color:#6b7280;">لا توجد مواد</td></tr>'}</tbody>
      </table>

      <div class="totals">
        <p>المجموع: <span class="num">${escapeHtml(invoice.subtotal.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${invoice.discount > 0 ? `<p>الخصم: <span class="num">${escapeHtml(invoice.discount.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
        <p class="grand">الإجمالي: <span class="num">${escapeHtml(invoice.total.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${invoice.type === 'credit' ? `<p>المدفوع: <span class="num">${escapeHtml(invoice.paidAmount.toLocaleString('ar-IQ'))}</span> | المتبقي: <span class="num">${escapeHtml(invoice.remaining.toLocaleString('ar-IQ'))}</span></p>` : ''}
      </div>

      ${invoice.notes ? `<p class="notes">ملاحظات: ${escapeHtml(invoice.notes)}</p>` : ''}
      ${settings.invoiceFooter ? `<div class="doc-footer">${escapeHtml(settings.invoiceFooter)}</div>` : ''}
    </div></div>`;
}

export async function printInvoice(invoice: Invoice, items: InvoiceItem[], settings: OfficeSettings): Promise<boolean> {
  return printHtmlDocument(invoice.invoiceNumber, buildInvoicePrintHtml(invoice, items, settings));
}

export function buildReceiptPrintHtml(payment: Payment, settings: OfficeSettings, remainingDebt?: number): string {
  const currency = escapeHtml(settings.currency || '');
  const methodText = payment.method === 'cash' ? 'نقدي' : payment.method === 'transfer' ? 'تحويل' : 'أخرى';
  return `
    <div class="doc receipt"><div class="page" style="text-align:center;">
      ${officeNameHeading(settings, 'h2')}
      ${settings.phone ? `<p class="muted num">${escapeHtml(settings.phone)}</p>` : ''}
      <hr />
      <h3 style="font-size:15px;">وصل قبض</h3>
      <div class="lines">
        <p><strong>رقم الوصل:</strong> <span class="num">${escapeHtml(payment.receiptNumber)}</span></p>
        <p><strong>التاريخ:</strong> ${escapeHtml(formatDate(payment.date, true))}</p>
        <p><strong>الزبون:</strong> ${escapeHtml(payment.customerName)}</p>
        <p><strong>طريقة الدفع:</strong> ${methodText}</p>
      </div>
      <hr />
      <p class="amount">المبلغ: <span class="num">${escapeHtml(payment.amount.toLocaleString('ar-IQ'))}</span> ${currency}</p>
      ${remainingDebt !== undefined ? `<p>الدين المتبقي: <span class="num">${escapeHtml(remainingDebt.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
      ${payment.notes ? `<p class="muted">ملاحظات: ${escapeHtml(payment.notes)}</p>` : ''}
      <hr />
      <p class="muted">${escapeHtml(settings.invoiceFooter || 'شكراً لتعاملكم معنا')}</p>
    </div></div>`;
}

export async function printReceipt(payment: Payment, settings: OfficeSettings, remainingDebt?: number): Promise<boolean> {
  return printHtmlDocument(payment.receiptNumber, buildReceiptPrintHtml(payment, settings, remainingDebt));
}

export function buildCustomerStatementPrintHtml(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): string {
  const currency = escapeHtml(settings.currency || '');

  const invoiceRows = invoices
    .map(
      (invoice) => `
        <tr>
          <td class="name">${escapeHtml(formatDate(invoice.date))}</td>
          <td class="c num">${escapeHtml(invoice.invoiceNumber)}</td>
          <td class="c">${invoice.type === 'cash' ? 'نقدي' : 'آجل'}</td>
          <td class="l num">${escapeHtml(invoice.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const paymentRows = payments
    .map(
      (payment) => `
        <tr>
          <td class="name">${escapeHtml(formatDate(payment.date))}</td>
          <td class="c num">${escapeHtml(payment.receiptNumber)}</td>
          <td class="l num">${escapeHtml(payment.amount.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
        <h2 style="font-size:16px; margin-top:6px;">كشف حساب الزبون</h2>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="wrap">الزبون: <strong>${escapeHtml(customer.fullName)}</strong></p>
          <p class="pair">الهاتف: <span class="v num">${escapeHtml(customer.phone || '—')}</span></p>
        </div>
        <div class="col">
          <p class="wrap">العنوان: <strong>${escapeHtml(customer.address || '—')}</strong></p>
          <p class="balance" style="color:${totalDebt > 0 ? '#dc2626' : '#15803d'};">الرصيد المتبقي: <span class="num">${escapeHtml(totalDebt.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        </div>
      </div>

      <h3 class="section-title">الفواتير</h3>
      <table class="grid">
        <colgroup><col style="width:30%" /><col style="width:28%" /><col style="width:17%" /><col style="width:25%" /></colgroup>
        <thead><tr><th>التاريخ</th><th class="c">رقم الفاتورة</th><th class="c">النوع</th><th class="l">المبلغ</th></tr></thead>
        <tbody>${invoiceRows || '<tr><td colspan="4" class="c" style="color:#6b7280;">لا توجد فواتير</td></tr>'}</tbody>
      </table>

      <h3 class="section-title">التسديدات</h3>
      <table class="grid">
        <colgroup><col style="width:35%" /><col style="width:35%" /><col style="width:30%" /></colgroup>
        <thead><tr><th>التاريخ</th><th class="c">رقم الوصل</th><th class="l">المبلغ</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="3" class="c" style="color:#6b7280;">لا توجد تسديدات</td></tr>'}</tbody>
      </table>
    </div></div>`;
}

export async function printCustomerStatement(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): Promise<boolean> {
  return printHtmlDocument(
    `كشف حساب - ${customer.fullName}`,
    buildCustomerStatementPrintHtml(customer, invoices, payments, settings, totalDebt)
  );
}

export function buildPurchasePrintHtml(purchase: Purchase, items: PurchaseItem[], settings: OfficeSettings): string {
  const currency = escapeHtml(settings.currency || '');
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td class="c num">${index + 1}</td>
          <td class="name">${escapeHtml(item.materialName)}</td>
          <td class="c num">${escapeHtml(item.quantity)}</td>
          <td class="c num">${escapeHtml(item.purchasePrice.toLocaleString('ar-IQ'))}</td>
          <td class="l num">${escapeHtml(item.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const methodText = purchase.paymentMethod === 'cash' ? 'نقدي' : 'آجل';

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" />` : ''}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
        <h2 style="font-size:16px; margin-top:8px; color:#8f7048;">وصل شراء / إدخال مخزن</h2>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="pair">رقم الوصل: <span class="v num">${escapeHtml(purchase.purchaseNumber)}</span></p>
          <p class="wrap">المورد: <strong>${escapeHtml(purchase.supplierName)}</strong></p>
          <p class="pair">طريقة الدفع: <span class="v">${methodText}</span></p>
        </div>
        <div class="col">
          <p class="pair">التاريخ: <span class="v">${escapeHtml(formatDate(purchase.date, true))}</span></p>
          <p class="pair">عدد المواد: <span class="v">${purchase.itemsCount}</span></p>
        </div>
      </div>

      <table class="grid">
        <colgroup>
          <col style="width:8%" />
          <col style="width:42%" />
          <col style="width:13%" />
          <col style="width:17%" />
          <col style="width:20%" />
        </colgroup>
        <thead>
          <tr><th class="c">#</th><th>المادة</th><th class="c">الكمية</th><th class="c">سعر الشراء</th><th class="l">الإجمالي</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="c" style="color:#6b7280;">لا توجد مواد</td></tr>'}</tbody>
      </table>

      <div class="totals">
        <p>المجموع: <span class="num">${escapeHtml(purchase.subtotal.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${purchase.discount > 0 ? `<p>الخصم: <span class="num">${escapeHtml(purchase.discount.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
        <p class="grand">الإجمالي: <span class="num">${escapeHtml(purchase.total.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${purchase.paymentMethod === 'credit' ? `<p>المدفوع: <span class="num">${escapeHtml(purchase.paidAmount.toLocaleString('ar-IQ'))}</span> | المتبقي على المكتب: <span class="num">${escapeHtml(purchase.remaining.toLocaleString('ar-IQ'))}</span></p>` : ''}
      </div>

      ${purchase.notes ? `<p class="notes">ملاحظات: ${escapeHtml(purchase.notes)}</p>` : ''}
      ${settings.invoiceFooter ? `<div class="doc-footer">${escapeHtml(settings.invoiceFooter)}</div>` : ''}
    </div></div>`;
}

export async function printPurchase(purchase: Purchase, items: PurchaseItem[], settings: OfficeSettings): Promise<boolean> {
  return printHtmlDocument(purchase.purchaseNumber, buildPurchasePrintHtml(purchase, items, settings));
}
