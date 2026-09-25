import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '@/App';
import { seedOfficeProfile } from './helpers';

/**
 * سؤال المستخدم: «ما الفرق بين فاتورة بيع جديدة ووصل شراء جديد؟»
 *
 * الشرح متاح داخل التطبيق من لوحة التحكم (وبجانب كل زر في صفحات المبيعات
 * والمشتريات والنماذج)، ويُغلق بزر الإغلاق أو Escape مثل بقية طبقات التطبيق.
 */

beforeEach(() => {
  cleanup();
  window.location.hash = '#/';
});

describe('شرح الفرق بين الفاتورة ووصل الشراء', () => {
  it('يُفتح من لوحة التحكم ويشرح حركة المخزن والديون ثم يُغلق بـ Escape', async () => {
    await seedOfficeProfile('مكتب الاختبار الزراعي');
    render(<App />);

    const trigger = await screen.findByRole(
      'button',
      { name: 'ما الفرق بين فاتورة البيع ووصل الشراء؟' },
      { timeout: 5000 }
    );
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'ما الفرق بين فاتورة البيع ووصل الشراء؟' });
    expect(within(dialog).getByText('فاتورة بيع جديدة')).toBeTruthy();
    expect(within(dialog).getByText('وصل شراء جديد')).toBeTruthy();
    expect(within(dialog).getByText(/المواد تخرج من المخزن فتنقص كميتها/)).toBeTruthy();
    expect(within(dialog).getByText(/المواد تدخل المخزن فتزيد كميتها/)).toBeTruthy();
    expect(within(dialog).getByText(/الدين يظهر باسم الزبون في كشف حسابه/)).toBeTruthy();
    expect(within(dialog).getByText(/الدين يبقى للمورد ولا يدخل في ديون الزبائن/)).toBeTruthy();

    // Escape يُغلق الطبقة العليا وحدها (مكدس النوافذ المركزي)
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // اللوحة ما زالت أمام المستخدم بعد الإغلاق
    expect(screen.getByText('إجراءات سريعة')).toBeTruthy();
  });

  it('تظهر هوية كل إجراء على بطاقته في لوحة التحكم (مبيعات/مشتريات واتجاه المخزن)', async () => {
    await seedOfficeProfile('مكتب الاختبار الزراعي');
    render(<App />);

    const saleCard = await screen.findByText('فاتورة بيع جديدة', undefined, { timeout: 5000 });
    const purchaseCard = screen.getByText('وصل شراء جديد');
    expect(saleCard).toBeTruthy();
    expect(purchaseCard).toBeTruthy();
    expect(screen.getByText('مبيعات — خروج من المخزن')).toBeTruthy();
    expect(screen.getByText('مشتريات — إدخال إلى المخزن')).toBeTruthy();
  });
});
