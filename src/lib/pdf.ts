import jsPDF from 'jspdf';
import { OfficeSettings, Invoice, InvoiceItem, Payment, Customer } from '@/types';
import { formatCurrency, formatDate } from './utils';

export async function generateInvoicePDF(
  invoice: Invoice,
  items: InvoiceItem[],
  settings: OfficeSettings,
  customer?: Customer
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'A4'
  });

  // For Arabic support, we need to handle RTL. jsPDF has limited Arabic support.
  // We'll create a visually appealing invoice with English numbers but Arabic labels
  // In production, you'd want to use a custom font with Arabic support

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  // Header - Office Info
  if (settings.logo) {
    try {
      doc.addImage(settings.logo, 'PNG', margin, y, 30, 30);
    } catch (e) {
      console.log('Logo add failed', e);
    }
  }

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.officeName || 'المكتب الزراعي', pageWidth / 2, y + 10, { align: 'center' });
  
  y += 15;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (settings.address) {
    doc.text(settings.address, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }
  if (settings.phone) {
    doc.text(`Phone: ${settings.phone}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }
  
  y += 10;
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Invoice Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const invoiceTitle = invoice.type === 'cash' ? 'فاتورة نقدية - Cash Invoice' : 'فاتورة آجلة - Credit Invoice';
  doc.text(invoiceTitle, pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Invoice Info
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, margin, y);
  doc.text(`Date: ${formatDate(invoice.date, true)}`, pageWidth - margin, y, { align: 'right' });
  y += 7;
  
  doc.text(`Customer: ${invoice.customerName}`, margin, y);
  if (customer?.phone) {
    doc.text(`Phone: ${customer.phone}`, pageWidth - margin, y, { align: 'right' });
  }
  y += 7;
  
  if (customer?.address) {
    doc.text(`Address: ${customer.address}`, margin, y);
    y += 7;
  }

  y += 5;
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Items Table Header
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y - 6, pageWidth - 2 * margin, 10, 'F');
  
  doc.text('#', margin + 2, y);
  doc.text('Item', margin + 10, y);
  doc.text('Qty', pageWidth - margin - 60, y, { align: 'center' });
  doc.text('Price', pageWidth - margin - 40, y, { align: 'center' });
  doc.text('Total', pageWidth - margin - 10, y, { align: 'right' });
  y += 8;

  // Items
  doc.setFont('helvetica', 'normal');
  items.forEach((item, index) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(`${index + 1}`, margin + 2, y);
    doc.text(item.materialName.substring(0, 35), margin + 10, y);
    doc.text(`${item.quantity}`, pageWidth - margin - 60, y, { align: 'center' });
    doc.text(`${item.unitPrice.toLocaleString()}`, pageWidth - margin - 40, y, { align: 'center' });
    doc.text(`${item.total.toLocaleString()}`, pageWidth - margin - 10, y, { align: 'right' });
    y += 7;
  });

  y += 5;
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Totals
  doc.setFont('helvetica', 'bold');
  doc.text(`Subtotal: ${invoice.subtotal.toLocaleString()} ${settings.currency}`, pageWidth - margin, y, { align: 'right' });
  y += 7;
  if (invoice.discount > 0) {
    doc.text(`Discount: ${invoice.discount.toLocaleString()} ${settings.currency}`, pageWidth - margin, y, { align: 'right' });
    y += 7;
  }
  doc.setFontSize(13);
  doc.text(`TOTAL: ${invoice.total.toLocaleString()} ${settings.currency}`, pageWidth - margin, y, { align: 'right' });
  y += 10;

  // Payment info for credit
  if (invoice.type === 'credit') {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Paid: ${invoice.paidAmount.toLocaleString()} | Remaining: ${invoice.remaining.toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
    y += 10;
  }

  // Footer
  if (settings.invoiceFooter) {
    y += 10;
    doc.setFontSize(9);
    doc.text(settings.invoiceFooter, pageWidth / 2, y, { align: 'center' });
  }

  // Save
  const fileName = `${invoice.invoiceNumber}_${invoice.customerName}.pdf`;
  doc.save(fileName);
  return fileName;
}

export async function generateReceiptPDF(
  payment: Payment,
  settings: OfficeSettings,
  customerDebtAfter?: number
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 200] // Thermal printer size
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 5;
  let y = 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.officeName || 'المكتب الزراعي', pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  if (settings.phone) {
    doc.text(settings.phone, pageWidth / 2, y, { align: 'center' });
    y += 4;
  }

  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('وصل قبض - Payment Receipt', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Receipt No: ${payment.receiptNumber}`, margin, y);
  y += 5;
  doc.text(`Date: ${formatDate(payment.date, true)}`, margin, y);
  y += 5;
  doc.text(`Customer: ${payment.customerName}`, margin, y);
  y += 5;
  doc.text(`Amount: ${payment.amount.toLocaleString()} ${settings.currency}`, margin, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Paid: ${payment.amount.toLocaleString()} ${settings.currency}`, pageWidth / 2, y, { align: 'center' });
  y += 6;

  if (customerDebtAfter !== undefined) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Remaining Debt: ${customerDebtAfter.toLocaleString()} ${settings.currency}`, pageWidth / 2, y, { align: 'center' });
    y += 6;
  }

  if (payment.notes) {
    doc.text(`Notes: ${payment.notes}`, margin, y);
    y += 5;
  }

  y += 5;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(7);
  doc.text('Thank you - شكرا لكم', pageWidth / 2, y, { align: 'center' });

  const fileName = `${payment.receiptNumber}.pdf`;
  doc.save(fileName);
  return fileName;
}

export async function generateCustomerStatementPDF(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(`كشف حساب - ${customer.fullName}`, pageWidth / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Phone: ${customer.phone || '-'} | Address: ${customer.address || '-'}`, pageWidth / 2, y, { align: 'center' });
  y += 8;
  doc.text(`Total Remaining Debt: ${totalDebt.toLocaleString()} ${settings.currency}`, pageWidth / 2, y, { align: 'center' });
  y += 10;

  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Invoices
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoices / الفواتير', margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin, y);
  doc.text('Invoice No', margin + 30, y);
  doc.text('Type', margin + 70, y);
  doc.text('Total', pageWidth - margin - 10, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  invoices.forEach(inv => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(formatDate(inv.date), margin, y);
    doc.text(inv.invoiceNumber, margin + 30, y);
    doc.text(inv.type === 'cash' ? 'Cash' : 'Credit', margin + 70, y);
    doc.text(`${inv.total.toLocaleString()}`, pageWidth - margin - 10, y, { align: 'right' });
    y += 6;
  });

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('Payments / المدفوعات', margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.text('Date', margin, y);
  doc.text('Receipt No', margin + 30, y);
  doc.text('Amount', pageWidth - margin - 10, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  payments.forEach(pay => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(formatDate(pay.date), margin, y);
    doc.text(pay.receiptNumber, margin + 30, y);
    doc.text(`${pay.amount.toLocaleString()}`, pageWidth - margin - 10, y, { align: 'right' });
    y += 6;
  });

  const fileName = `Statement_${customer.fullName}_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(fileName);
  return fileName;
}

export function printElement(elementId: string) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  
  const styles = Array.from(document.styleSheets)
    .map(sheet => {
      try {
        return Array.from(sheet.cssRules).map(rule => rule.cssText).join('');
      } catch {
        return '';
      }
    })
    .join('');

  printWindow.document.write(`
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <title>طباعة</title>
        <style>${styles}</style>
        <style>
          body { font-family: 'Cairo', sans-serif; padding: 20px; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${element.innerHTML}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
