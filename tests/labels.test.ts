import { describe, expect, it } from 'vitest';
import {
  documentNumberMatches,
  formatDocumentNumber,
  formatFileSize,
  notificationSourceLabel,
  notificationTypeLabel,
  paymentMethodLabel,
  roleLabel,
  saleTypeLabel
} from '@/lib/labels';
import { toCsv } from '@/lib/csv';

const LATIN = /[A-Za-z]/;

describe('تسميات عربية لكل قيمة داخلية (لا system ولا info في الواجهة)', () => {
  it('أنواع ومصادر الإشعارات عربية دائماً، حتى للقيم غير المعروفة', () => {
    expect(notificationTypeLabel('info')).toBe('معلومة');
    expect(notificationTypeLabel('warning')).toBe('تنبيه');
    expect(notificationTypeLabel('error')).toBe('خطأ');
    expect(notificationTypeLabel('success')).toBe('نجاح');
    expect(notificationSourceLabel('system')).toBe('النظام');
    expect(notificationSourceLabel('material')).toBe('المخزن');
    expect(notificationSourceLabel('customer')).toBe('الزبائن');
    expect(notificationSourceLabel('invoice')).toBe('الفواتير');
    expect(notificationSourceLabel('payment')).toBe('التسديدات');
    // قيمة من إصدار أحدث أو نسخة تالفة: لا تتسرّب كما هي
    for (const value of ['debug', 'backup', undefined, null, 42]) {
      expect(notificationTypeLabel(value)).not.toMatch(LATIN);
      expect(notificationSourceLabel(value)).not.toMatch(LATIN);
    }
  });

  it('طرق الدفع والصلاحيات وأنواع الفواتير', () => {
    expect(paymentMethodLabel('cash')).toBe('نقدي');
    expect(paymentMethodLabel('transfer')).toBe('تحويل');
    expect(paymentMethodLabel('other')).toBe('أخرى');
    expect(paymentMethodLabel('card')).toBe('أخرى');
    expect(roleLabel('admin')).toBe('مدير');
    expect(roleLabel('sales')).toBe('موظف مبيعات');
    expect(saleTypeLabel('cash')).toBe('نقدي');
    expect(saleTypeLabel('credit')).toBe('آجل');
  });

  it('أحجام الملفات بوحدات عربية بدل KB و MB', () => {
    expect(formatFileSize(0)).toBe('0 بايت');
    expect(formatFileSize(512)).toBe('512 بايت');
    expect(formatFileSize(2048)).toBe('2 ك.ب');
    expect(formatFileSize(1536)).toBe('1.5 ك.ب');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 م.ب');
    expect(formatFileSize(Number.NaN)).toBe('0 بايت');
  });
});

describe('أرقام المستندات بالعربية', () => {
  it('تعرض الأرقام القديمة (INV/REC) بالبادئة العربية مع الأرقام نفسها', () => {
    expect(formatDocumentNumber('INV-202609-0001')).toBe('ف-202609-0001');
    expect(formatDocumentNumber('REC-2026-00012')).toBe('ق-2026-00012');
    expect(formatDocumentNumber('INV-RESTORED-4')).toBe('ف-مستعاد-4');
    expect(formatDocumentNumber('INV-OLD-1')).toBe('ف-قديم-1');
    // الأرقام الجديدة عربية أصلاً وتبقى كما هي
    expect(formatDocumentNumber('ف-202609-0009')).toBe('ف-202609-0009');
    expect(formatDocumentNumber(undefined)).toBe('');
  });

  it('البحث يطابق الصيغة المخزّنة والمعروضة معاً', () => {
    expect(documentNumberMatches('INV-202609-0001', 'ف-2026')).toBe(true);
    expect(documentNumberMatches('INV-202609-0001', 'inv-2026')).toBe(true);
    expect(documentNumberMatches('ف-202609-0001', '0001')).toBe(true);
    expect(documentNumberMatches('ف-202609-0001', 'ق-')).toBe(false);
    expect(documentNumberMatches('ف-202609-0001', '  ')).toBe(true);
  });
});

describe('ملف الجدول (CSV) للتقارير', () => {
  it('يبدأ بعلامة BOM وعناوين عربية ويهرّب الفواصل والاقتباس', () => {
    const csv = toCsv([
      ['الزبون', 'الدين'],
      ['أحمد, محمد', 1500],
      ['قال "مرحباً"', -20]
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('الزبون,الدين\r\n');
    // فاصلة لاتينية داخل الحقل ⇒ الحقل بين علامتي اقتباس
    expect(csv).toContain('"أحمد, محمد",1500');
    expect(csv).toContain('"قال ""مرحباً"""');
    expect(csv).toContain(',-20');
  });

  it('يحمي من حقن الصيغ في النصوص التي يكتبها المستخدم', () => {
    const csv = toCsv([['=HYPERLINK("x")', '+1', '@cmd', 'نص عادي']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain('نص عادي');
  });
});
