import { escapeHtml, formatDate } from './utils';
import type { Customer, Invoice, InvoiceItem, OfficeSettings, Payment } from '@/types';

/**
 * طباعة عبر نافذة منفصلة.
 *
 * كل قيمة ديناميكية تُهرَّب عبر escapeHtml لأن أسماء الزبائن والمواد
 * والملاحظات تُدخل يدوياً وقد تصل أيضاً من ملف نسخة احتياطية مستورد؛
 * إدراجها خاماً داخل document.write كان يسمح بتنفيذ شيفرة (XSS).
 */

export function openPrintWindow(title: string, bodyHtml: string): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html dir="rtl" lang="ar">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 24px; color: #111827; }
      h1, h2, h3, p { margin: 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #d1d5db; padding: 8px 10px; }
      @media print {
        body { padding: 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`);
  printWindow.document.close();

  const triggerPrint = () => {
    try {
      printWindow.opener = null;
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    } catch (error) {
      console.warn('تعذّر فتح حوار الطباعة:', error);
    }
  };

  // الانتظار حتى تكتمل الخطوط حتى لا تُطبع الصفحة قبل تنسيقها
  const fonts = (printWindow.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) {
    fonts.ready.then(() => window.setTimeout(triggerPrint, 150)).catch(() => window.setTimeout(triggerPrint, 400));
  } else {
    window.setTimeout(triggerPrint, 400);
  }

  return true;
}

export function buildInvoicePrintHtml(
  invoice: Invoice,
  items: InvoiceItem[],
  settings: OfficeSettings
): string {
  const currency = escapeHtml(settings.currency);
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td style="text-align:center">${index + 1}</td>
          <td>${escapeHtml(item.materialName)}</td>
          <td style="text-align:center">${escapeHtml(item.quantity)}</td>
          <td style="text-align:center">${escapeHtml(item.unitPrice.toLocaleString('ar-IQ'))}</td>
          <td style="text-align:left">${escapeHtml(item.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  return `
    <div style="max-width: 800px; margin: 0 auto;">
      <div style="text-align:center; border-bottom:2px solid #8f7048; padding-bottom:12px; margin-bottom:16px;">
        <h1 style="color:#8f7048; font-size:22px;">${escapeHtml(settings.officeName)}</h1>
        ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" style="max-height:64px;margin-top:8px;" />` : ''}
        <p style="color:#6b7280; font-size:12px; margin-top:6px;">${escapeHtml(settings.address || '')}${
          settings.address && settings.phone ? ' | ' : ''
        }${escapeHtml(settings.phone || '')}</p>
      </div>

      <div style="display:flex; justify-content:space-between; margin-bottom:16px; font-size:13px;">
        <div>
          <p><strong>رقم الفاتورة:</strong> ${escapeHtml(invoice.invoiceNumber)}</p>
          <p><strong>الزبون:</strong> ${escapeHtml(invoice.customerName)}</p>
          <p><strong>النوع:</strong> ${invoice.type === 'cash' ? 'نقدي' : 'آجل'}</p>
        </div>
        <div style="text-align:left;">
          <p><strong>التاريخ:</strong> ${escapeHtml(formatDate(invoice.date, true))}</p>
          <p><strong>الحالة:</strong> ${
            invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'
          }</p>
        </div>
      </div>

      <table style="margin-bottom:16px;">
        <thead>
          <tr style="background:#f0fdf4;">
            <th style="text-align:center;">#</th>
            <th>المادة</th>
            <th style="text-align:center;">الكمية</th>
            <th style="text-align:center;">السعر</th>
            <th style="text-align:left;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="text-align:left; border-top:2px solid #8f7048; padding-top:12px; font-size:13px;">
        <p>المجموع: ${escapeHtml(invoice.subtotal.toLocaleString('ar-IQ'))} ${currency}</p>
        ${invoice.discount > 0 ? `<p>الخصم: ${escapeHtml(invoice.discount.toLocaleString('ar-IQ'))} ${currency}</p>` : ''}
        <p style="font-size:17px; font-weight:bold; color:#8f7048;">الإجمالي: ${escapeHtml(
          invoice.total.toLocaleString('ar-IQ')
        )} ${currency}</p>
        ${
          invoice.type === 'credit'
            ? `<p>المدفوع: ${escapeHtml(invoice.paidAmount.toLocaleString('ar-IQ'))} | المتبقي: ${escapeHtml(
                invoice.remaining.toLocaleString('ar-IQ')
              )}</p>`
            : ''
        }
      </div>

      ${invoice.notes ? `<p style="margin-top:12px; font-size:12px; color:#6b7280;">ملاحظات: ${escapeHtml(invoice.notes)}</p>` : ''}

      ${
        settings.invoiceFooter
          ? `<div style="text-align:center; margin-top:24px; padding-top:12px; border-top:1px dashed #d1d5db; color:#6b7280; font-size:12px;">${escapeHtml(
              settings.invoiceFooter
            )}</div>`
          : ''
      }
    </div>`;
}

export function printInvoice(invoice: Invoice, items: InvoiceItem[], settings: OfficeSettings): boolean {
  return openPrintWindow(invoice.invoiceNumber, buildInvoicePrintHtml(invoice, items, settings));
}

export function buildReceiptPrintHtml(
  payment: Payment,
  settings: OfficeSettings,
  remainingDebt?: number
): string {
  const currency = escapeHtml(settings.currency);
  return `
    <div style="max-width: 320px; margin: 0 auto; text-align: center; font-size: 13px;">
      <h2 style="font-size:17px;">${escapeHtml(settings.officeName)}</h2>
      ${settings.phone ? `<p style="color:#6b7280;">${escapeHtml(settings.phone)}</p>` : ''}
      <hr style="border:0; border-top:1px dashed #9ca3af; margin:10px 0;" />
      <h3 style="font-size:15px;">وصل قبض</h3>
      <div style="text-align:right; margin-top:10px; line-height:1.9;">
        <p><strong>رقم الوصل:</strong> ${escapeHtml(payment.receiptNumber)}</p>
        <p><strong>التاريخ:</strong> ${escapeHtml(formatDate(payment.date, true))}</p>
        <p><strong>الزبون:</strong> ${escapeHtml(payment.customerName)}</p>
        <p><strong>طريقة الدفع:</strong> ${
          payment.method === 'cash' ? 'نقدي' : payment.method === 'transfer' ? 'تحويل' : 'أخرى'
        }</p>
      </div>
      <hr style="border:0; border-top:1px dashed #9ca3af; margin:10px 0;" />
      <p style="font-size:18px; font-weight:bold; color:#8f7048;">
        المبلغ: ${escapeHtml(payment.amount.toLocaleString('ar-IQ'))} ${currency}
      </p>
      ${
        remainingDebt !== undefined
          ? `<p>الدين المتبقي: ${escapeHtml(remainingDebt.toLocaleString('ar-IQ'))} ${currency}</p>`
          : ''
      }
      ${payment.notes ? `<p style="color:#6b7280; font-size:12px;">ملاحظات: ${escapeHtml(payment.notes)}</p>` : ''}
      <hr style="border:0; border-top:1px dashed #9ca3af; margin:10px 0;" />
      <p style="color:#6b7280; font-size:12px;">${escapeHtml(settings.invoiceFooter || 'شكراً لتعاملكم معنا')}</p>
    </div>`;
}

export function printReceipt(payment: Payment, settings: OfficeSettings, remainingDebt?: number): boolean {
  return openPrintWindow(payment.receiptNumber, buildReceiptPrintHtml(payment, settings, remainingDebt));
}

export function buildCustomerStatementPrintHtml(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): string {
  const currency = escapeHtml(settings.currency);

  const invoiceRows = invoices
    .map(
      (invoice) => `
        <tr>
          <td>${escapeHtml(formatDate(invoice.date))}</td>
          <td>${escapeHtml(invoice.invoiceNumber)}</td>
          <td>${invoice.type === 'cash' ? 'نقدي' : 'آجل'}</td>
          <td style="text-align:left">${escapeHtml(invoice.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const paymentRows = payments
    .map(
      (payment) => `
        <tr>
          <td>${escapeHtml(formatDate(payment.date))}</td>
          <td>${escapeHtml(payment.receiptNumber)}</td>
          <td style="text-align:left">${escapeHtml(payment.amount.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  return `
    <div style="max-width: 800px; margin: 0 auto;">
      <div style="text-align:center; border-bottom:2px solid #8f7048; padding-bottom:12px; margin-bottom:16px;">
        <h1 style="color:#8f7048; font-size:20px;">${escapeHtml(settings.officeName)}</h1>
        <h2 style="font-size:16px; margin-top:6px;">كشف حساب الزبون</h2>
      </div>

      <div style="font-size:13px; line-height:1.9; margin-bottom:14px;">
        <p><strong>الزبون:</strong> ${escapeHtml(customer.fullName)}</p>
        <p><strong>الهاتف:</strong> ${escapeHtml(customer.phone || '—')} &nbsp; <strong>العنوان:</strong> ${escapeHtml(customer.address || '—')}</p>
        <p style="font-size:15px; font-weight:bold; color:${totalDebt > 0 ? '#dc2626' : '#8f7048'};">
          الرصيد المتبقي: ${escapeHtml(totalDebt.toLocaleString('ar-IQ'))} ${currency}
        </p>
      </div>

      <h3 style="font-size:14px; margin-bottom:6px;">الفواتير</h3>
      <table style="margin-bottom:16px;">
        <thead><tr style="background:#f0fdf4;"><th>التاريخ</th><th>رقم الفاتورة</th><th>النوع</th><th style="text-align:left">المبلغ</th></tr></thead>
        <tbody>${invoiceRows || '<tr><td colspan="4" style="text-align:center;color:#6b7280;">لا توجد فواتير</td></tr>'}</tbody>
      </table>

      <h3 style="font-size:14px; margin-bottom:6px;">التسديدات</h3>
      <table>
        <thead><tr style="background:#f0fdf4;"><th>التاريخ</th><th>رقم الوصل</th><th style="text-align:left">المبلغ</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="3" style="text-align:center;color:#6b7280;">لا توجد تسديدات</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function printCustomerStatement(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): boolean {
  return openPrintWindow(
    `كشف حساب - ${customer.fullName}`,
    buildCustomerStatementPrintHtml(customer, invoices, payments, settings, totalDebt)
  );
}
