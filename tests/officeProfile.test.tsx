import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import * as dbModule from '@/lib/db';
import { db, getSettings, updateSettings } from '@/lib/db';
import { createMountScope } from '@/lib/lifecycle';
import {
  isOfficeProfileComplete,
  normalizePhone,
  toLatinDigits,
  validateOfficeProfile
} from '@/lib/officeProfile';
import { loadFormDraft } from '@/lib/formDraft';
import { seedOfficeProfile } from './helpers';

/**
 * بيانات المكتب (الترويسة) — انحدارات المشكلات المُبلَّغ عنها:
 *   1) المعالج يجب ألا يُتخطّى: كل الحقول إلزامية عدا الشعار.
 *   2) "عند الحفظ يُحذف النص / يختفي": الحفظ كان يعلق بصمت (نطاق إلغاء ميت
 *      بعد إعادة التركيب)، والنتيجة المحفوظة كانت تُكتب فوق ما يكتبه المستخدم،
 *      والنص غير المحفوظ كان يضيع عند مغادرة الشاشة.
 */

const change = (element: Element, value: string) => fireEvent.change(element, { target: { value } });
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  cleanup();
  window.location.hash = '#/';
});

async function waitForSetup() {
  await waitFor(() => expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب/)).toBeTruthy(), {
    timeout: 5000
  });
}

describe('قواعد بيانات المكتب', () => {
  const complete = {
    officeName: 'مكتب الرافدين',
    phone: '07801234567',
    currency: 'د.ع',
    address: 'الأنبار',
    invoiceFooter: 'شكراً'
  };

  it('كل الحقول إلزامية عدا الشعار', () => {
    expect(validateOfficeProfile(complete).ok).toBe(true);
    for (const field of ['officeName', 'phone', 'currency', 'address', 'invoiceFooter'] as const) {
      const result = validateOfficeProfile({ ...complete, [field]: '   ' });
      expect(result.ok, field).toBe(false);
      expect(result.errors[field], field).toBeTruthy();
    }
  });

  it('يقبل الأرقام العربية في الهاتف ويحفظها لاتينية', () => {
    expect(toLatinDigits('٠٧٨٠١٢٣٤٥٦٧')).toBe('07801234567');
    expect(toLatinDigits('۰۷۸۰')).toBe('0780');
    expect(normalizePhone(' ٠٧٨٠ ١٢٣-٤٥٦٧ ')).toBe('07801234567');
    expect(normalizePhone('+964 780 123 4567')).toBe('+9647801234567');

    const result = validateOfficeProfile({ ...complete, phone: '٠٧٨٠١٢٣٤٥٦٧' });
    expect(result.ok && result.value.phone).toBe('07801234567');
    expect(validateOfficeProfile({ ...complete, phone: '0780abc' }).ok).toBe(false);
    expect(validateOfficeProfile({ ...complete, phone: '123' }).ok).toBe(false);
  });

  it('يرفض عملة غير مدعومة ويعتبر الإعداد الناقص غير مكتمل', () => {
    expect(validateOfficeProfile({ ...complete, currency: 'XYZ' }).errors.currency).toBeTruthy();
    expect(isOfficeProfileComplete({ ...complete, phone: '' })).toBe(false);
    expect(isOfficeProfileComplete(complete)).toBe(true);
    expect(isOfficeProfileComplete(null)).toBe(false);
  });
});

describe('نطاق الإلغاء عبر إعادة التركيب', () => {
  it('يتجدّد بعد تركيب ← إلغاء ← تركيب (StrictMode) بدل أن يبقى ملغى', async () => {
    const scope = createMountScope();
    scope.mount();
    scope.unmount();
    expect(scope.aborted).toBe(true);
    scope.mount();
    expect(scope.aborted).toBe(false);
    await expect(scope.run(async () => 42)).resolves.toBe(42);
  });
});

describe('معالج التشغيل الأول لا يمكن تخطيه', () => {
  it('يرفض الحفظ بالاسم وحده ويُبقي المعالج مع رسائل لكل حقل ناقص', async () => {
    render(<App />);
    await waitForSetup();

    change(byId('setup-officeName'), 'مكتب الرافدين');
    fireEvent.click(screen.getByText(/حفظ وبدء استخدام النظام/));

    await waitFor(() => expect(screen.getByText('رقم الهاتف مطلوب')).toBeTruthy());
    expect(screen.getByText('العنوان مطلوب')).toBeTruthy();
    // التركيز ينتقل لأول حقل خاطئ
    expect(document.activeElement).toBe(byId('setup-phone'));
    // لم يُحفظ شيء والمعالج ما زال ظاهراً
    expect((await getSettings())?.officeName).toBe('');
    expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب/)).toBeTruthy();
    // النص المكتوب لم يُمس
    expect(byId('setup-officeName').value).toBe('مكتب الرافدين');
  });

  it('يعود المعالج إذا كانت بيانات الترويسة ناقصة (نسخة قديمة بالاسم فقط)', async () => {
    await updateSettings({ officeName: 'مكتب قديم', phone: '', address: '' });
    render(<App />);
    await waitForSetup();
    // القيم الموجودة معبّأة مسبقاً — لا يعيد المستخدم كتابتها
    expect(byId('setup-officeName').value).toBe('مكتب قديم');
  });

  it('يحفظ فعلاً تحت StrictMode (كان زر الحفظ يعلق على "جاري الحفظ…")', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    await waitForSetup();

    change(byId('setup-officeName'), 'مكتب الكرمة الزراعي');
    change(byId('setup-phone'), '٠٧٨٠١٢٣٤٥٦٧');
    change(byId('setup-address'), 'الأنبار - الكرمة');
    fireEvent.click(screen.getByText(/حفظ وبدء استخدام النظام/));

    await waitFor(() => expect(screen.getByTestId('dashboard-office-name').textContent).toBe('مكتب الكرمة الزراعي'), {
      timeout: 5000
    });
    const saved = await getSettings();
    expect(saved?.officeName).toBe('مكتب الكرمة الزراعي');
    expect(saved?.phone).toBe('07801234567');
    expect(saved?.address).toBe('الأنبار - الكرمة');
    expect(saved?.invoiceFooter).toBe('شكراً لتعاملكم معنا');
  });
});

describe('صفحة الإعدادات: لا يضيع ولا يُحذف ما يكتبه المستخدم', () => {
  async function openSettings(strict = false) {
    window.location.hash = '#/settings';
    render(strict ? <StrictMode><App /></StrictMode> : <App />);
    await waitFor(() => expect(byId('settings-officeName')?.value).toBe('مكتب الاختبار الزراعي'), {
      timeout: 5000
    });
  }

  it('يحفظ تحت StrictMode ويظهر الاسم الجديد في التخطيط', async () => {
    await seedOfficeProfile();
    await openSettings(true);

    change(byId('settings-officeName'), 'مكتب الفرات');
    change(byId('settings-address'), 'بغداد - الكرادة');
    fireEvent.click(screen.getByText('حفظ جميع الإعدادات'));

    await waitFor(() => expect(screen.getByText('جميع التعديلات محفوظة')).toBeTruthy(), { timeout: 5000 });
    const saved = await getSettings();
    expect(saved?.officeName).toBe('مكتب الفرات');
    expect(saved?.address).toBe('بغداد - الكرادة');
    expect(byId('settings-officeName').value).toBe('مكتب الفرات');
  });

  it('ما يُكتب أثناء الحفظ لا يُستبدل بالقيمة المحفوظة', async () => {
    await seedOfficeProfile();
    await openSettings();

    // حفظ بطيء: نكتب في الحقل قبل انتهائه
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = dbModule.updateSettings;
    const spy = vi.spyOn(dbModule, 'updateSettings').mockImplementation(async (updates) => {
      await gate;
      return original(updates);
    });

    change(byId('settings-officeName'), 'مكتب الفرات');
    fireEvent.click(screen.getByText('حفظ جميع الإعدادات'));
    await waitFor(() => expect(screen.getByText('جاري الحفظ…')).toBeTruthy());

    change(byId('settings-officeName'), 'مكتب الفرات الأوسط');
    await act(async () => {
      release();
      await gate;
    });

    await waitFor(() => expect(screen.getByText('حفظ جميع الإعدادات')).toBeTruthy(), { timeout: 5000 });
    // النص المكتوب أثناء الحفظ باقٍ، ويبقى معلَّماً كغير محفوظ
    expect(byId('settings-officeName').value).toBe('مكتب الفرات الأوسط');
    expect(screen.getByText(/لديك تعديلات غير محفوظة/)).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('يرفض حفظ بيانات ناقصة ويُبقي النص كما هو', async () => {
    await seedOfficeProfile();
    await openSettings();

    change(byId('settings-phone'), '');
    change(byId('settings-invoiceFooter'), 'نص جديد');
    fireEvent.click(screen.getByText('حفظ جميع الإعدادات'));

    await waitFor(() => expect(screen.getByText('رقم الهاتف مطلوب')).toBeTruthy());
    expect(byId('settings-invoiceFooter').value).toBe('نص جديد');
    expect((await getSettings())?.phone).toBe('07801234567');
  });

  it('يستعيد التعديلات غير المحفوظة بعد مغادرة الصفحة أو إعادة تشغيل التطبيق', async () => {
    await seedOfficeProfile();
    await openSettings();

    change(byId('settings-address'), 'البصرة - العشار');
    await waitFor(() => expect(loadFormDraft<{ profile: { address: string } }>('settings-office')?.profile.address).toBe('البصرة - العشار'));

    // "إعادة تشغيل" قبل الحفظ (مثل إنهاء أندرويد للتطبيق في الخلفية)
    cleanup();
    await openSettingsExpectingDraft();
    expect(byId('settings-address').value).toBe('البصرة - العشار');
    expect(screen.getByText(/استُعيدت تعديلات لم تُحفظ/)).toBeTruthy();

    // التراجع يعيد القيم المحفوظة ويحذف المسودة
    fireEvent.click(screen.getByText('تجاهل التعديلات'));
    await waitFor(() => expect(byId('settings-address').value).toBe('الأنبار - الكرمة'));
    expect(loadFormDraft('settings-office')).toBeNull();
  });

  it('يمكن مسح حقل الرقم وإعادة كتابته (كان يقفز إلى 0)', async () => {
    await seedOfficeProfile();
    await openSettings();

    const threshold = screen.getByDisplayValue('5') as HTMLInputElement;
    change(threshold, '');
    expect(threshold.value).toBe('');
    change(threshold, '12');
    fireEvent.click(screen.getByText('حفظ جميع الإعدادات'));
    await waitFor(() => expect(screen.getByText('جميع التعديلات محفوظة')).toBeTruthy(), { timeout: 5000 });
    expect((await getSettings())?.lowStockThreshold).toBe(12);
  });

  it('الحفظ لا يمسح تاريخ آخر نسخة احتياطية المكتوب في الخلفية', async () => {
    await seedOfficeProfile();
    await openSettings();

    // النسخ التلقائي يكتب lastBackup بعد تحميل الصفحة
    const stamp = '2026-09-23T10:00:00.000Z';
    const row = await db.settings.toCollection().first();
    await db.settings.update(row!.id!, { lastBackup: stamp });

    change(byId('settings-officeName'), 'مكتب الفرات');
    fireEvent.click(screen.getByText('حفظ جميع الإعدادات'));
    await waitFor(() => expect(screen.getByText('جميع التعديلات محفوظة')).toBeTruthy(), { timeout: 5000 });
    expect((await getSettings())?.lastBackup).toBe(stamp);
  });

  async function openSettingsExpectingDraft() {
    window.location.hash = '#/settings';
    render(<App />);
    await waitFor(() => expect(screen.getByText(/استُعيدت تعديلات لم تُحفظ/)).toBeTruthy(), { timeout: 5000 });
  }
});
