import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { db } from '@/lib/db';

/**
 * اختبار إقلاع حقيقي: يُركّب التطبيق بالكامل (ErrorBoundary + Router + Layout +
 * لوحة التحكم) على قاعدة IndexedDB وهمية، ويتأكد من ظهور الواجهة بدل شاشة سوداء.
 */
describe('إقلاع التطبيق', () => {
  it('يعرض لوحة التحكم بعد تهيئة قاعدة البيانات', async () => {
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
