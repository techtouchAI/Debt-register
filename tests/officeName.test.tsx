import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { db, getSettings, updateSettings } from '@/lib/db';
import { backupFileName, createBackup, importedBackupFileName } from '@/lib/backup';
import { buildInvoicePrintHtml, buildReceiptPrintHtml } from '@/lib/print';
import {
  MAX_OFFICE_NAME_LENGTH,
  normalizeOfficeName,
  officeNameFontSize,
  validateOfficeName
} from '@/lib/officeName';
import { MAX_FILE_NAME_BYTES, sanitizeFileName, truncateToUtf8Bytes, utf8ByteLength } from '@/lib/utils';
import type { Invoice, InvoiceItem, OfficeSettings } from '@/types';

/**
 * اسم المكتب الطويل — أحد المتطلبات المتبقية في التدقيق:
 *   - يُدخل في التشغيل الأول ويُحفظ كاملاً.
 *   - يظهر كاملاً في التخطيط والفواتير والنسخ الاحتياطية بعد إعادة التشغيل.
 *   - لا يُقتطع في اسم ملف النسخة الاحتياطية.
 */

/** اسم مكتب عربي طويل جداً (150 حرفاً) مع مسافات داخلية. */
const LONG_NAME =
  'مكتب الرافدين الزراعي لتجارة البذور والأسمدة والمبيدات والآلات الزراعية ومستلزمات الري الحديث في قضاء الكرمة - محافظة الأنبار';
const LONG_NAME_200 = LONG_NAME.repeat(2);

beforeEach(() => {
  cleanup();
  window.location.hash = '#/';
});

function settingsWith(officeName: string): OfficeSettings {
  return {
    officeName,
    phone: '07701234567',
    address: 'الأنبار - الكرمة',
    currency: 'د.ع',
    lowStockThreshold: 5,
    theme: 'light',
    autoBackupEnabled: true,
    autoBackupInterval: 60,
    language: 'ar',
    invoiceFooter: 'شكراً لتعاملكم معنا'
  };
}

function sampleInvoice(): Invoice {
  return {
    invoiceNumber: 'INV-2026-0001',
    type: 'credit',
    customerId: 1,
    customerName: 'زبون طويل الاسم أيضاً',
    itemsCount: 1,
    subtotal: 1000,
    discount: 0,
    total: 1000,
    paidAmount: 0,
    remaining: 1000,
    date: new Date('2026-05-03T09:00:00Z').toISOString(),
    createdAt: new Date('2026-05-03T09:00:00Z').toISOString(),
    updatedAt: new Date('2026-05-03T09:00:00Z').toISOString(),
    status: 'unpaid',
    id: 1
  };
}

const sampleItems: InvoiceItem[] = [
  { id: 1, invoiceId: 1, materialId: 1, materialName: 'يوريا', quantity: 1, unitPrice: 1000, total: 1000 }
];

describe('قواعد اسم المكتب', () => {
  it('يقبل الاسم الطويل ويرفض الفراغ والتجاوز مع رسالة واضحة', () => {
    expect(validateOfficeName(LONG_NAME).ok).toBe(true);
    expect(validateOfficeName(LONG_NAME).value).toBe(LONG_NAME);

    const empty = validateOfficeName('   ');
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('اسم المكتب مطلوب');

    const tooLong = validateOfficeName('م'.repeat(MAX_OFFICE_NAME_LENGTH + 5));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toContain(`${MAX_OFFICE_NAME_LENGTH}`);
  });

  it('يطبّع الأسطر والفراغات دون المساس بالمحتوى', () => {
    expect(normalizeOfficeName('  مكتب\nالرافدين\tالزراعي  ')).toBe('مكتب الرافدين الزراعي');
    expect(normalizeOfficeName('مكتب  الرافدين')).toBe('مكتب الرافدين');
    expect(normalizeOfficeName(null)).toBe('');
  });

  it('يصغّر خط الترويسة للأسماء الطويلة بدل اقتطاعها', () => {
    expect(officeNameFontSize('مكتب صغير')).toBe(22);
    expect(officeNameFontSize(LONG_NAME)).toBeLessThan(22);
    expect(officeNameFontSize(LONG_NAME_200)).toBeLessThanOrEqual(16);
  });
});

describe('اسم المكتب في التشغيل الأول وإعادة التشغيل', () => {
  it('يُحفظ كاملاً ويظهر كاملاً في التخطيط بعد إعادة تشغيل التطبيق', async () => {
    // التشغيل الأول: لا يوجد اسم مكتب بعد
    render(<App />);
    await waitFor(() => expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب الزراعي/)).toBeTruthy(), {
      timeout: 5000
    });

    const input = screen.getByPlaceholderText(/اكتب اسم مكتبك هنا/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: LONG_NAME } });
    // لا استبدال ولا اقتطاع أثناء الكتابة: القيمة الحقلية تساوي الاسم كاملاً
    expect(input.value).toBe(LONG_NAME);
    expect(input.maxLength).toBe(MAX_OFFICE_NAME_LENGTH);

    fireEvent.click(screen.getByText(/حفظ وبدء استخدام النظام/));

    // يظهر الاسم كاملاً في الترحيب
    await waitFor(
      () => {
        expect(screen.getByText(`مرحباً بك في ${LONG_NAME} 🌾`)).toBeTruthy();
      },
      { timeout: 5000 }
    );

    const stored = await getSettings();
    expect(stored?.officeName).toBe(LONG_NAME);

    // التخطيط (الشريط الجانبي) يعرض الاسم كاملاً بلا اقتطاع نصي.
    // ننتظر ظهوره لأن استعلامات Dexie الحيّة تصل في إطار رسم لاحق؛
    // الاستعلام المتزامن كان يجعل هذا الاختبار متذبذباً (flaky).
    await waitFor(
      () => {
        expect(screen.getByTitle(LONG_NAME).textContent).toBe(LONG_NAME);
      },
      { timeout: 5000 }
    );

    // إعادة تشغيل فعلية للتطبيق: إلغاء التركيب ثم تركيبه من جديد على نفس القاعدة
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<App />);
    await waitFor(() => expect(screen.getByText(`مرحباً بك في ${LONG_NAME} 🌾`)).toBeTruthy(), {
      timeout: 5000
    });
    expect(screen.queryByText(/مرحباً بك في نظام إدارة المكتب الزراعي/)).toBeNull();
    // بعد إعادة التركيب أيضاً: ننتظر التخطيط بدل افتراض جهوزيته الفورية
    await waitFor(
      () => {
        expect(screen.getByTitle(LONG_NAME).textContent).toBe(LONG_NAME);
      },
      { timeout: 5000 }
    );
  });

  it('يظهر كاملاً في ترويسة الفاتورة والوصل وفي ملف النسخة الاحتياطية', async () => {
    await updateSettings({ officeName: LONG_NAME });
    const settings = (await getSettings()) as OfficeSettings;

    const invoiceHtml = buildInvoicePrintHtml(sampleInvoice(), sampleItems, settings);
    expect(invoiceHtml).toContain(LONG_NAME);
    // ونفس الاسم في ترويسة الوصل الحراري
    const receiptHtml = buildReceiptPrintHtml(
      {
        id: 1,
        customerId: 1,
        customerName: 'زبون',
        amount: 500,
        date: new Date().toISOString(),
        method: 'cash',
        receiptNumber: 'REC-1',
        createdAt: new Date().toISOString(),
        source: 'manual'
      },
      settings,
      0
    );
    expect(receiptHtml).toContain(LONG_NAME);

    // النسخة الاحتياطية تحمل الاسم الكامل داخل الملف
    const backup = await createBackup();
    expect(backup.officeName).toBe(LONG_NAME);
    expect(JSON.stringify(backup)).toContain(LONG_NAME);
  });

  it('يعرض الاسم الكامل في صفحة الإعدادات دون اقتطاع', async () => {
    await updateSettings({ officeName: LONG_NAME });
    window.location.hash = '#/settings';
    render(<App />);

    await waitFor(() => expect(screen.getByDisplayValue(LONG_NAME)).toBeTruthy(), { timeout: 5000 });
    const displayed = screen.getByDisplayValue(LONG_NAME) as HTMLInputElement;
    expect(displayed.value.length).toBe(LONG_NAME.length);
    expect(displayed.title).toBe(LONG_NAME);
  });
});

describe('اسم ملف النسخة الاحتياطية مع اسم مكتب طويل', () => {
  it('لا يُقتطع الاسم المحفوظ ويبقى اسم الملف ضمن حدود البايتات', () => {
    const date = new Date(2026, 4, 3, 9, 8, 7);
    const fileName = backupFileName(LONG_NAME, date);

    // اسم الملف كامل البنية: الاسم + التاريخ + الوقت + الامتداد
    expect(fileName.endsWith('_Backup_2026-05-03_09-08-07.json')).toBe(true);
    expect(utf8ByteLength(fileName)).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES + 30);
    // الطوابع الزمنية والامتداد لا تُقتطع أبداً
    expect(fileName).toMatch(/_Backup_2026-05-03_09-08-07\.json$/);
    // يبدأ ببداية اسم المكتب الحقيقي (لا اسم عام)
    expect(fileName.startsWith('مكتب الرافدين')).toBe(true);
    expect(fileName).not.toContain('AgriOffice_Backup');

    // الاسم الكامل يبقى في محتوى الملف ولو طال
    expect(backupFileName(LONG_NAME_200, date).endsWith('_Backup_2026-05-03_09-08-07.json')).toBe(true);
    expect(utf8ByteLength(backupFileName(LONG_NAME_200, date))).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES + 40);
  });

  it('يحتفظ بأسماء المكاتب القصيرة كما هي', () => {
    const date = new Date(2026, 4, 3, 9, 8, 7);
    expect(backupFileName('مكتب الرافدين الزراعي', date)).toBe(
      'مكتب الرافدين الزراعي_Backup_2026-05-03_09-08-07.json'
    );
    expect(backupFileName('', date)).toBe('AgriOffice_Backup_2026-05-03_09-08-07.json');
  });

  it('اسم ملف الاستيراد محدود أيضاً بالبايتات', () => {
    const imported = importedBackupFileName(`${LONG_NAME_200}.json`);
    expect(utf8ByteLength(imported)).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES);
    expect(imported.endsWith('.json')).toBe(true);
    expect(imported).toContain('_Imported_');
  });

  it('الاقتطاع لا يكسر المحارف ولا يترك فواصل معلّقة', () => {
    const truncated = truncateToUtf8Bytes('مكتب الرافدين الزراعي الطويل', 12);
    // 12 بايت = 6 أحرف عربية بالضبط
    expect(truncated).toBe('مكتب ا');
    expect(truncated.endsWith(' ')).toBe(false);
    expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(12);
    expect(sanitizeFileName('مكتب الرافدين ', 'x')).toBe('مكتب الرافدين');
  });
});
