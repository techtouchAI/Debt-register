import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '@/App';
import { createNotification, db } from '@/lib/db';
import { createUser } from '@/lib/users';
import { hashPin } from '@/lib/security';
import { getSessionUser } from '@/lib/session';
import { seedOfficeProfile } from './helpers';

afterEach(() => cleanup());

/**
 * اختبارات تكامل على التطبيق كاملاً: للمستخدمين أثر فعلي الآن —
 * شاشة دخول برمز، وصلاحيات موظف المبيعات في القائمة والمسارات والأزرار.
 */
async function seedTeam() {
  await seedOfficeProfile('مكتب الاختبار الزراعي');
  const admin = (await db.users.toArray()).find((user) => user.role === 'admin');
  await db.users.update(admin?.id as number, { pin: await hashPin('4321') });
  await createUser({ name: 'أحمد', role: 'sales', pin: '5678', confirmPin: '5678' });
}

async function pressPin(pin: string) {
  for (const digit of pin) fireEvent.click(screen.getByRole('button', { name: digit }));
}

/** اختيار المستخدم كما تراه التقنيات المساعدة: زر فعلي داخل قائمة «المستخدمون». */
function chooseUser(name: string) {
  const list = screen.getByRole('list', { name: 'المستخدمون' });
  fireEvent.click(within(list).getByRole('button', { name: new RegExp(name) }));
}

async function loginAs(name: string, pin: string) {
  await waitFor(() => expect(screen.getByText('اختر المستخدم')).toBeTruthy(), { timeout: 5000 });
  chooseUser(name);
  await waitFor(() => expect(screen.getByRole('button', { name: 'دخول' })).toBeTruthy());
  await pressPin(pin);
  fireEvent.click(screen.getByRole('button', { name: 'دخول' }));
  await waitFor(() => expect(screen.getByTestId('dashboard-office-name')).toBeTruthy(), { timeout: 5000 });
}

describe('شاشة الدخول برمز المستخدم', () => {
  it('تظهر عند وجود أكثر من مستخدم، ترفض الرمز الخاطئ وتقبل الصحيح', async () => {
    await seedTeam();
    window.location.hash = '#/';
    render(<App />);

    await waitFor(() => expect(screen.getByText('اختر المستخدم')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByTestId('dashboard-office-name')).toBeNull();
    expect(screen.getByTestId('lock-office-name').textContent).toBe('مكتب الاختبار الزراعي');

    chooseUser('أحمد');
    await pressPin('1111');
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(screen.getByText(/رمز الدخول غير صحيح — المحاولات المتبقية: 4/)).toBeTruthy());
    expect(getSessionUser()).toBeNull();

    // لوحة المفاتيح (ويندوز): أرقام عربية ثم Enter
    for (const key of ['٥', '٦', '٧', '٨']) fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('dashboard-office-name')).toBeTruthy(), { timeout: 5000 });
    expect(getSessionUser()).toMatchObject({ name: 'أحمد', role: 'sales' });
    expect(screen.getByTestId('session-user-name').textContent).toBe('أحمد');
  });

  it('زر القفل يعيد شاشة الدخول لتبديل المستخدم', async () => {
    await seedTeam();
    window.location.hash = '#/';
    render(<App />);
    await loginAs('المدير', '4321');

    fireEvent.click(await screen.findByLabelText('قفل التطبيق وتبديل المستخدم'));
    // شاشة الدخول تختار آخر من دخل مباشرة، ويمكن تغييره بزر "تغيير المستخدم"
    await waitFor(() => expect(screen.getByRole('button', { name: 'دخول' })).toBeTruthy(), { timeout: 5000 });
    expect(getSessionUser()).toBeNull();
    expect(screen.queryByTestId('dashboard-office-name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'تغيير المستخدم' }));
    await waitFor(() => expect(screen.getByText('اختر المستخدم')).toBeTruthy());
    chooseUser('أحمد');
    await pressPin('5678');
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(getSessionUser()?.name).toBe('أحمد'), { timeout: 5000 });
  });

  it('المكتب بلا مستخدمين إضافيين يدخل مباشرة كمدير (لا قفل مفاجئ)', async () => {
    await seedOfficeProfile('مكتب الاختبار الزراعي');
    window.location.hash = '#/';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('dashboard-office-name')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText('اختر المستخدم')).toBeNull();
    expect(screen.queryByLabelText('قفل التطبيق وتبديل المستخدم')).toBeNull();
    expect(getSessionUser()?.role).toBe('admin');
  });
});

describe('موظف المبيعات: بيع فقط', () => {
  it('لا يرى التقارير والنسخ والإعدادات، ولا إجراءات المدير السريعة', async () => {
    await seedTeam();
    window.location.hash = '#/';
    render(<App />);
    await loginAs('أحمد', '5678');

    const nav = screen.getByLabelText('التنقل الرئيسي');
    for (const allowed of ['لوحة التحكم', 'المخزن والمواد', 'العملاء', 'الفواتير والمبيعات', 'التسديدات']) {
      expect(within(nav).getByText(allowed)).toBeTruthy();
    }
    for (const hidden of ['التقارير', 'النسخ الاحتياطي', 'الإعدادات']) {
      expect(within(nav).queryByText(hidden)).toBeNull();
    }
    expect(screen.getByText('فاتورة بيع جديدة')).toBeTruthy();
    expect(screen.getByText('تسديد دين')).toBeTruthy();
    expect(screen.queryByText('إضافة مادة')).toBeNull();
  });

  it('فتح صفحة المدير برابط مباشر يحوّل للرئيسية', async () => {
    await seedTeam();
    window.location.hash = '#/settings';
    render(<App />);
    await loginAs('أحمد', '5678');
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(screen.queryByText('إعدادات النظام والمكتب والمظهر')).toBeNull();
  });

  it('يرى الفواتير ويطبعها بلا أزرار تعديل أو حذف', async () => {
    await seedTeam();
    const now = new Date().toISOString();
    await db.invoices.add({
      invoiceNumber: 'ف-202609-0001',
      type: 'cash',
      customerName: 'زبون نقدي',
      itemsCount: 0,
      subtotal: 1000,
      discount: 0,
      total: 1000,
      paidAmount: 1000,
      remaining: 0,
      date: now,
      createdAt: now,
      status: 'paid'
    });
    window.location.hash = '#/';
    render(<App />);
    await loginAs('أحمد', '5678');
    window.location.hash = '#/invoices';
    await waitFor(
      () =>
        expect(
          screen.getByText(
            'مبيعاتك: تخرج المواد من المخزن وتُسجَّل على الزبون نقداً أو ديناً. أدخل الكميات الجديدة وتكلفتها من صفحة المخزن.'
          )
        ).toBeTruthy(),
      { timeout: 5000 }
    );
    await waitFor(() => expect(screen.getByLabelText('عرض الفاتورة')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByLabelText('طباعة الفاتورة')).toBeTruthy();
    expect(screen.queryByLabelText('تعديل الفاتورة')).toBeNull();
    expect(screen.queryByLabelText('حذف الفاتورة')).toBeNull();
  });
});

describe('إدارة المستخدمين من الإعدادات لها أثر فعلي', () => {
  it('إضافة موظف مبيعات تحفظه وتفعّل قفل الدخول وتقترح رمز استرداد', async () => {
    await seedOfficeProfile('مكتب الاختبار الزراعي');
    window.location.hash = '#/settings';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('lock-status')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId('lock-status').textContent).toContain('بوابة الدخول غير مفعّلة');

    fireEvent.click(screen.getByRole('button', { name: 'إضافة مستخدم' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة مستخدم جديد' });
    // الاسم يبقى إلزامياً، أما رمز الدخول فهو اختياري.
    fireEvent.click(within(dialog).getByRole('button', { name: 'إضافة المستخدم' }));
    await waitFor(() => expect(within(dialog).getByText('اسم المستخدم مطلوب')).toBeTruthy());

    fireEvent.change(within(dialog).getByLabelText('اسم المستخدم'), { target: { value: 'سارة' } });
    fireEvent.change(within(dialog).getByLabelText(/رمز الدخول/), { target: { value: '2468' } });
    fireEvent.change(within(dialog).getByLabelText('تأكيد الرمز'), { target: { value: '2468' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'إضافة المستخدم' }));

    await waitFor(() => expect(screen.getAllByTestId('user-row')).toHaveLength(2), { timeout: 5000 });
    const stored = await db.users.where('name').equals('سارة').first();
    expect(stored?.role).toBe('sales');
    await waitFor(() => expect(screen.getByTestId('lock-status').textContent).toContain('بوابة الدخول مفعّلة'));
    // اقتراح رمز الاسترداد بعد تفعيل القفل
    fireEvent.click(await screen.findByRole('button', { name: 'لاحقاً' }));
    expect(screen.queryByText(/الرمز الافتراضي/)).toBeNull();
    // زر القفل يظهر الآن في الشريط العلوي
    expect(await screen.findByLabelText('قفل التطبيق وتبديل المستخدم')).toBeTruthy();
  });
});

describe('واجهة عربية بالكامل', () => {
  it('الإشعارات تعرض المصدر والنوع بالعربية لا system/info', async () => {
    await seedOfficeProfile('مكتب الاختبار الزراعي');
    await createNotification('إشعار تجريبي', 'نص الإشعار', { type: 'info', relatedType: 'system', code: 'test' });
    window.location.hash = '#/notifications';
    render(<App />);
    await waitFor(() => expect(screen.getByText('نص الإشعار')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('النظام')).toBeTruthy();
    expect(screen.getByText('معلومة')).toBeTruthy();
    expect(screen.queryByText('system')).toBeNull();
    expect(screen.queryByText('info')).toBeNull();
  });

  it('الرئيسية تعرض اسم المكتب وحده دون "مرحباً بك في"', async () => {
    await seedOfficeProfile('مكتب الرافدين');
    window.location.hash = '#/';
    render(<App />);
    const name = await screen.findByTestId('dashboard-office-name', {}, { timeout: 5000 });
    expect(name.textContent).toBe('مكتب الرافدين');
    expect(name.tagName).toBe('H1');
    expect(screen.queryByText(/مرحباً بك في/)).toBeNull();
    // خط أصغر من السابق (كان text-2xl / lg:text-3xl)
    expect(name.className).toContain('text-lg');
    expect(name.className).not.toContain('text-3xl');
  });
});
