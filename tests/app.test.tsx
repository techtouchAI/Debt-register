import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// إزالة كل تركيب سابق بعد كل اختبار حتى لا تتداخل نسخ التطبيق
afterEach(() => cleanup());
import App from '@/App';
import { db, getSettings } from '@/lib/db';
import { fillRequiredSetupFields, seedOfficeProfile } from './helpers';

/**
 * اختبار إقلاع حقيقي: يُركّب التطبيق بالكامل (ErrorBoundary + Router + Layout +
 * لوحة التحكم) على قاعدة IndexedDB وهمية، ويتأكد من ظهور الواجهة بدل شاشة سوداء.
 */
describe('إقلاع التطبيق', () => {
  it('يعرض لوحة التحكم بعد تهيئة قاعدة البيانات', async () => {
    // مكتب مُعد مسبقاً حتى لا يظهر معالج التشغيل الأول
    await seedOfficeProfile('مكتب الاختبار');
    const now = new Date().toISOString();
    await db.materials.add({
      name: 'سماد يوريا',
      quantity: 3,
      salePrice: 2000,
      minQuantity: 5,
      unit: 'كيس',
      category: 'أسمدة',
      createdAt: now,
      updatedAt: now
    });
    await db.customers.add({ fullName: 'زبون تجريبي', createdAt: now, updatedAt: now });

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
      },
      { timeout: 4000 }
    );

    // عناصر التنقل والمحتوى موجودة (لوحة التحكم تظهر في القائمة والشريط العلوي)
    expect(screen.getAllByText('لوحة التحكم').length).toBeGreaterThan(0);
    expect(screen.getAllByText('المخزن والمواد').length).toBeGreaterThan(0);
    expect(screen.getByText('إجراءات سريعة')).toBeTruthy();
    expect(screen.getByText('آخر الفواتير')).toBeTruthy();
    // لم نسقط في حاجز الأخطاء
    expect(screen.queryByText('حدث خطأ غير متوقع')).toBeNull();
  });

  it('يعرض معالج إعداد المكتب في التشغيل الأول بدل اسم تلقائي', async () => {
    // قاعدة جديدة: الإعدادات الافتراضية بلا اسم مكتب
    const settings = await getSettings();
    expect(settings?.officeName ?? '').toBe('');

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب الزراعي/)).toBeTruthy();
      },
      { timeout: 4000 }
    );

    // حقل الاسم فارغ — لا يُكتب أي اسم تلقائياً
    const nameInput = screen.getByPlaceholderText(/اكتب اسم مكتبك هنا/) as HTMLInputElement;
    expect(nameInput.value).toBe('');

    fireEvent.change(nameInput, { target: { value: 'مكتب الرافدين الزراعي' } });
    fillRequiredSetupFields(
      (element, value) => fireEvent.change(element, { target: { value } }),
      (id) => document.getElementById(id)!
    );
    fireEvent.click(screen.getByText(/حفظ وبدء استخدام النظام/));

    await waitFor(
      () => {
        expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();
      },
      { timeout: 4000 }
    );
    expect((await getSettings())?.officeName).toBe('مكتب الرافدين الزراعي');
  });

  it('يعرض شاشة خطأ واضحة عندما يتعذّر فتح قاعدة البيانات', async () => {
    // محاكاة بيئة ترفض IndexedDB (وضع التصفح الخاص / تخزين معطّل)
    const openSpy = vi.spyOn(db, 'open').mockRejectedValue(new DOMException('access denied', 'SecurityError'));

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText(/تعذّر فتح قاعدة البيانات المحلية/)).toBeTruthy();
      },
      { timeout: 4000 }
    );

    expect(screen.getByText('إعادة المحاولة')).toBeTruthy();
    openSpy.mockRestore();
  });
});
