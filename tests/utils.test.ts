import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  toFiniteNumber,
  formatLocalDateInput,
  formatLocalDateTimeInput,
  parseLocalDate,
  localDayRangeISO,
  startOfDayLocal,
  endOfDayLocal,
  isSameLocalDay,
  escapeHtml,
  sanitizeFileName,
  getStockStatus,
  toISOStringOrNull,
  calculateProfit,
  formatDate,
  isValidDate
} from '@/lib/utils';
import { buildInvoicePrintHtml, buildReceiptPrintHtml } from '@/lib/print';
import { hashPin, verifyPin, isValidPin, isHashedPin } from '@/lib/security';
import type { Invoice, InvoiceItem, OfficeSettings, Payment } from '@/types';

describe('الأرقام والمبالغ', () => {
  it('يقرّب المبالغ دون أخطاء الفاصلة العائمة', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1000.005)).toBe(1000.01);
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Number('abc'))).toBe(0);
  });

  it('يحوّل القيم غير الصالحة إلى بديل آمن', () => {
    expect(toFiniteNumber('1500')).toBe(1500);
    expect(toFiniteNumber('  12 ')).toBe(12);
    expect(toFiniteNumber('')).toBe(0);
    expect(toFiniteNumber('abc', 5)).toBe(5);
    expect(toFiniteNumber(undefined, 7)).toBe(7);
    expect(toFiniteNumber(null, NaN)).toBeNaN();
  });

  it('يحسب الربح ويتجاهل سعر الشراء المفقود', () => {
    expect(calculateProfit(2000, 1500, 4)).toBe(2000);
    expect(calculateProfit(2000, undefined, 4)).toBe(0);
    expect(calculateProfit(2000, 0, 4)).toBe(0);
  });
});

describe('التواريخ المحلية', () => {
  it('ينسّق التاريخ والوقت محلياً وليس بتوقيت UTC', () => {
    const date = new Date(2026, 4, 3, 1, 5, 0); // 3 مايو 2026 - 01:05 محلياً
    expect(formatLocalDateInput(date)).toBe('2026-05-03');
    expect(formatLocalDateTimeInput(date)).toBe('2026-05-03T01:05');
  });

  it('يحمي تحويل تواريخ حقول الإدخال من RangeError', () => {
    expect(toISOStringOrNull('')).toBeNull();
    expect(toISOStringOrNull('ليس تاريخاً')).toBeNull();
    expect(toISOStringOrNull(null)).toBeNull();
    expect(toISOStringOrNull(undefined)).toBeNull();
    expect(toISOStringOrNull('2026-05-03T09:00')).toBe(new Date('2026-05-03T09:00').toISOString());
  });

  it('يقرأ YYYY-MM-DD كبداية يوم محلي', () => {
    const date = parseLocalDate('2026-05-03');
    expect(date).not.toBeNull();
    expect(date?.getHours()).toBe(0);
    expect(date?.getDate()).toBe(3);
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('2026/05/03')).toBeNull();
    expect(parseLocalDate('2026-02-31')).toBeNull();
  });

  it('يحسب نطاق اليوم محلياً ويرفض التاريخ الفارغ', () => {
    const range = localDayRangeISO('2026-05-03', '2026-05-04');
    expect(range).not.toBeNull();
    expect(new Date(range!.from).getTime()).toBe(startOfDayLocal(new Date(2026, 4, 3)).getTime());
    expect(new Date(range!.to).getTime()).toBe(endOfDayLocal(new Date(2026, 4, 4)).getTime());

    // سبب الانهيار السابق: حقل تاريخ فارغ ← Invalid time value
    expect(localDayRangeISO('', '2026-05-04')).toBeNull();
    expect(localDayRangeISO('2026-05-03', '')).toBeNull();
  });

  it('يعكس النطاق إذا أدخل المستخدم التاريخين معكوسين', () => {
    const range = localDayRangeISO('2026-05-10', '2026-05-01');
    expect(new Date(range!.from).getDate()).toBe(1);
    expect(new Date(range!.to).getDate()).toBe(10);
  });

  it('يطابق اليوم المحلي بغض النظر عن المنطقة الزمنية', () => {
    const localMorning = new Date(2026, 4, 3, 0, 30).toISOString();
    expect(isSameLocalDay(localMorning, '2026-05-03')).toBe(true);
    expect(isSameLocalDay(localMorning, '2026-05-04')).toBe(false);
    expect(isSameLocalDay('ليس تاريخاً', '2026-05-03')).toBe(false);
  });

  it('يعرض علامة بدل تاريخ غير صالح', () => {
    expect(isValidDate('2026-05-03T00:00:00.000Z')).toBe(true);
    expect(isValidDate('abc')).toBe(false);
    expect(formatDate('abc')).toBe('—');
  });
});

describe('أمان النصوص', () => {
  /** فحص حقيقي عبر DOM: لا وسوم خطرة ولا معالجات أحداث قابلة للتنفيذ */
  const assertInertHtml = (html: string) => {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    expect(doc.querySelectorAll('script, iframe, object, embed, link, style').length).toBe(0);
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.name.startsWith('on')).toBe(false);
        if (attribute.name === 'href' || attribute.name === 'src') {
          expect(attribute.value.trim().toLowerCase().startsWith('javascript:')).toBe(false);
        }
      }
    }
  };

  it('يهرّب كل الأحرف الخطرة في HTML', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml(`" onmouseover="alert(1)`)).toBe('&quot; onmouseover=&quot;alert(1)');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('لا يسمح بتنفيذ شيفرة عبر اسم الزبون في صفحة الطباعة', () => {
    const settings: OfficeSettings = {
      officeName: 'مكتب <img src=x onerror=alert(1)>',
      phone: '',
      address: '',
      currency: 'د.ع',
      lowStockThreshold: 5,
      theme: 'light',
      autoBackupEnabled: true,
      autoBackupInterval: 60,
      language: 'ar',
      invoiceFooter: '<script>steal()</script>'
    };
    const invoice: Invoice = {
      id: 1,
      invoiceNumber: 'INV-1',
      type: 'credit',
      customerName: '<script>alert("xss")</script>',
      itemsCount: 1,
      subtotal: 1000,
      discount: 0,
      total: 1000,
      paidAmount: 0,
      remaining: 1000,
      date: '2026-05-03T09:00:00.000Z',
      createdAt: '2026-05-03T09:00:00.000Z',
      status: 'unpaid'
    };
    const items: InvoiceItem[] = [
      {
        id: 1,
        invoiceId: 1,
        materialId: 1,
        materialName: '<img src=x onerror=alert(2)>',
        quantity: 1,
        unitPrice: 1000,
        total: 1000
      }
    ];

    const html = buildInvoicePrintHtml(invoice, items, settings);
    assertInertHtml(html);
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('يهرّب ملاحظات وصل القبض', () => {
    const settings: OfficeSettings = {
      officeName: 'مكتب',
      phone: '',
      address: '',
      currency: 'د.ع',
      lowStockThreshold: 5,
      theme: 'light',
      autoBackupEnabled: true,
      autoBackupInterval: 60,
      language: 'ar'
    };
    const payment: Payment = {
      id: 1,
      customerId: 1,
      customerName: '<b>زبون</b>',
      amount: 500,
      date: '2026-05-03T09:00:00.000Z',
      method: 'cash',
      receiptNumber: 'REC-1',
      notes: '"><script>alert(3)</script>',
      createdAt: '2026-05-03T09:00:00.000Z'
    };

    const html = buildReceiptPrintHtml(payment, settings, 100);
    assertInertHtml(html);
    expect(html).toContain('&lt;b&gt;زبون&lt;/b&gt;');
  });

  it('ينظّف أسماء الملفات من محاولات اجتياز المسار', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFileName('a/b\\\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('مكتب الرافدين')).toBe('مكتب الرافدين');
  });
});

describe('حالة المخزون', () => {
  it('يصنف الحالة ويتحمل القيم المفقودة', () => {
    expect(getStockStatus(0, 5)).toBe('out');
    expect(getStockStatus(-3, 5)).toBe('out');
    expect(getStockStatus(3, 5)).toBe('low');
    expect(getStockStatus(50, 5)).toBe('normal');
    expect(getStockStatus(2, undefined as unknown as number)).toBe('normal');
  });
});

describe('رموز الدخول', () => {
  it('يتحقق من الرمز بعد تحويله إلى بصمة', async () => {
    const hashed = await hashPin('1234');
    expect(await verifyPin('1234', hashed)).toBe(true);
    expect(await verifyPin('4321', hashed)).toBe(false);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12ab')).toBe(false);
    expect(isValidPin('12')).toBe(false);
  });

  it('يتوافق مع الرموز القديمة غير المشفرة', async () => {
    expect(isHashedPin('1234')).toBe(false);
    expect(await verifyPin('1234', '1234')).toBe(true);
  });
});
