import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  DEFAULT_ADMIN_PIN,
  formatRecoveryCode,
  generateRecoveryCode,
  hasRecoveryCode,
  isLoginRequired,
  listLoginUsers,
  LOCKOUT_MS,
  loginRequiredFor,
  MAX_FAILED_ATTEMPTS,
  resetPinWithRecoveryCode,
  signIn,
  signOut,
  syncSessionWith,
  tryAutoSignIn
} from '@/lib/auth';
import { createUser, deleteUser, updateUser, UserRuleError, UserValidationError } from '@/lib/users';
import { getSessionUser, setSessionUser } from '@/lib/session';
import { hashPin, isHashedPin, verifyPin } from '@/lib/security';
import { PermissionDeniedError, roleCan, routePermission, ALL_PERMISSIONS } from '@/lib/permissions';
import { deleteInvoice, saveInvoice } from '@/lib/invoices';
import { saveCustomer, deleteCustomer } from '@/lib/customers';
import { createMaterial } from '@/lib/materials';
import { savePayment, deletePayment } from '@/lib/payments';
import { savePurchase } from '@/lib/purchases';
import { exportBackupToFile, saveSnapshot } from '@/lib/backup';

async function adminId(): Promise<number> {
  const admin = (await db.users.toArray()).find((user) => user.role === 'admin');
  return admin?.id as number;
}

async function addSales(name = 'أحمد', pin = '5678'): Promise<number> {
  return createUser({ name, role: 'sales', pin, confirmPin: pin });
}

describe('قرار قفل الدخول', () => {
  it('مدير واحد برمز افتراضي: لا قفل ودخول تلقائي كمدير (سلوك الإصدارات السابقة)', async () => {
    expect(await isLoginRequired()).toBe(false);
    expect(await tryAutoSignIn()).toBe(true);
    expect(getSessionUser()?.role).toBe('admin');
  });

  it('إضافة موظف مبيعات تفعّل القفل فلا دخول تلقائي', async () => {
    await addSales();
    expect(await isLoginRequired()).toBe(true);
    expect(await tryAutoSignIn()).toBe(false);
    expect(getSessionUser()).toBeNull();
  });

  it('تغيير رمز المدير الوحيد يفعّل القفل أيضاً', async () => {
    await db.users.update(await adminId(), { pin: await hashPin('4321') });
    expect(await isLoginRequired()).toBe(true);
  });

  it('الرمز الافتراضي يُكتشف نصاً كان أو بصمة', async () => {
    await db.users.update(await adminId(), { pin: await hashPin(DEFAULT_ADMIN_PIN) });
    const [admin] = await listLoginUsers();
    expect(admin.hasDefaultPin).toBe(true);
    expect(loginRequiredFor([admin])).toBe(false);
    expect(loginRequiredFor([])).toBe(false);
    expect(loginRequiredFor([admin, { hasDefaultPin: true }])).toBe(true);
  });
});

describe('الدخول برمز والإيقاف المؤقت', () => {
  it('الرمز الصحيح يفتح الجلسة، يسجّل آخر دخول، ويحوّل الرمز القديم النصي لبصمة', async () => {
    const id = await adminId();
    expect(isHashedPin((await db.users.get(id))?.pin)).toBe(false); // '1234' نصاً قبل الصيانة
    const result = await signIn(id, '١٢٣٤'); // أرقام عربية مقبولة
    expect(result.ok).toBe(true);
    expect(getSessionUser()).toMatchObject({ id, role: 'admin' });
    const stored = await db.users.get(id);
    expect(stored?.lastLogin).toBeTruthy();
    expect(isHashedPin(stored?.pin)).toBe(true);
    expect(await verifyPin('1234', stored?.pin ?? '')).toBe(true);
    const log = await db.activityLogs.orderBy('id').last();
    expect(log?.action).toBe('تسجيل دخول');
  });

  it('الرمز الخاطئ يُنقص المحاولات، ثم إيقاف مؤقت يرفض حتى الرمز الصحيح', async () => {
    const id = await adminId();
    const start = Date.UTC(2026, 8, 24, 10, 0, 0);
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const result = await signIn(id, '0000', start);
      expect(result).toEqual({ ok: false, reason: 'invalid', remainingAttempts: MAX_FAILED_ATTEMPTS - attempt });
    }
    const locked = await signIn(id, '0000', start);
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    // أثناء الإيقاف: الرمز الصحيح مرفوض أيضاً
    expect(await signIn(id, '1234', start + 1000)).toMatchObject({ ok: false, reason: 'locked' });
    expect(getSessionUser()).toBeNull();
    // بعد انقضاء المدة يُقبل الرمز الصحيح
    expect((await signIn(id, '1234', start + LOCKOUT_MS + 1)).ok).toBe(true);
  });

  it('صيغة الرمز غير الصالحة لا تُحتسب محاولة خاطئة', async () => {
    const result = await signIn(await adminId(), '12');
    expect(result).toEqual({ ok: false, reason: 'invalid-pin-format' });
  });

  it('الخروج يُنهي الجلسة ويُسجَّل باسم المستخدم', async () => {
    await signIn(await adminId(), '1234');
    await signOut();
    expect(getSessionUser()).toBeNull();
    const log = await db.activityLogs.orderBy('id').last();
    expect(log?.action).toBe('تسجيل خروج');
    expect(log?.userName).toBe('المدير');
  });

  it('مزامنة الجلسة: تعديل الاسم/الصلاحية يظهر، وحذف الحساب يُنهي الجلسة', async () => {
    const salesId = await addSales('سعيد', '2468');
    setSessionUser({ id: salesId, name: 'سعيد', role: 'sales' });
    syncSessionWith([{ id: salesId, name: 'سعيد علي', role: 'admin', pin: 'x', createdAt: '' }]);
    expect(getSessionUser()).toEqual({ id: salesId, name: 'سعيد علي', role: 'admin' });
    syncSessionWith([]);
    expect(getSessionUser()).toBeNull();
  });
});

describe('إدارة المستخدمين', () => {
  it('يتحقق من الحقول برسائل عربية لكل حقل', async () => {
    await expect(createUser({ name: '  ', role: 'sales', pin: '', confirmPin: '' })).rejects.toBeInstanceOf(UserValidationError);
    await expect(createUser({ name: '', role: 'sales', pin: '12', confirmPin: '12' })).rejects.toMatchObject({
      errors: {
        name: 'اسم المستخدم مطلوب',
        pin: 'رمز الدخول يجب أن يكون من 4 إلى 8 أرقام فقط'
      }
    });
    await expect(createUser({ name: 'علي', role: 'sales', pin: '1111', confirmPin: '2222' })).rejects.toMatchObject({
      errors: { confirmPin: 'تأكيد الرمز غير مطابق' }
    });
    await expect(createUser({ name: 'علي', role: 'sales', pin: '', confirmPin: '' })).rejects.toMatchObject({
      errors: { pin: 'رمز الدخول مطلوب (من 4 إلى 8 أرقام)' }
    });
    expect(await db.users.count()).toBe(1);
  });

  it('يمنع تكرار الاسم ولو اختلفت المسافات', async () => {
    await addSales('أحمد  علي');
    await expect(addSales(' أحمد علي ')).rejects.toMatchObject({
      errors: { name: 'يوجد مستخدم آخر بالاسم نفسه — اختر اسماً مختلفاً' }
    });
  });

  it('يحفظ الرمز كبصمة، والتعديل بلا رمز يُبقي الرمز الحالي', async () => {
    const id = await addSales('منى', '9753');
    const created = await db.users.get(id);
    expect(isHashedPin(created?.pin)).toBe(true);
    expect(created?.pin).not.toContain('9753');
    await updateUser(id, { name: 'منى أحمد', role: 'sales', pin: '', confirmPin: '' });
    const updated = await db.users.get(id);
    expect(updated?.name).toBe('منى أحمد');
    expect(updated?.pin).toBe(created?.pin);
    expect((await signIn(id, '9753')).ok).toBe(true);
  });

  it('يحمي آخر مدير وآخر مستخدم وحساب المستخدم الحالي', async () => {
    const admin = await adminId();
    await expect(updateUser(admin, { name: 'المدير', role: 'sales' })).rejects.toMatchObject({
      errors: { role: 'يجب بقاء مدير واحد على الأقل في النظام' }
    });
    await expect(deleteUser(admin)).rejects.toBeInstanceOf(UserRuleError);
    const salesId = await addSales();
    setSessionUser({ id: salesId, name: 'أحمد', role: 'sales' });
    // موظف المبيعات لا يدير المستخدمين أصلاً
    await expect(deleteUser(admin)).rejects.toBeInstanceOf(PermissionDeniedError);
    setSessionUser({ id: admin, name: 'المدير', role: 'admin' });
    await expect(deleteUser(admin)).rejects.toThrow('لا يمكنك حذف حسابك وأنت مسجّل الدخول به');
    await deleteUser(salesId);
    expect(await db.users.get(salesId)).toBeUndefined();
  });

  it('تعديل المستخدم الحالي يحدّث الجلسة فوراً', async () => {
    const admin = await adminId();
    await addSales();
    setSessionUser({ id: admin, name: 'المدير', role: 'admin' });
    await updateUser(admin, { name: 'أبو علي', role: 'admin', pin: '8642', confirmPin: '8642' });
    expect(getSessionUser()?.name).toBe('أبو علي');
  });
});

describe('رمز الاسترداد', () => {
  it('يُنشئه المدير فقط ويُحفظ كبصمة لا كنص', async () => {
    const salesId = await addSales();
    setSessionUser({ id: salesId, name: 'أحمد', role: 'sales' });
    await expect(generateRecoveryCode()).rejects.toBeInstanceOf(PermissionDeniedError);

    setSessionUser({ id: await adminId(), name: 'المدير', role: 'admin' });
    const code = await generateRecoveryCode();
    expect(code).toMatch(/^\d{12}$/);
    expect(formatRecoveryCode(code)).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(await hasRecoveryCode()).toBe(true);
    const stored = JSON.stringify(await db.meta.get('auth:recovery'));
    expect(stored).not.toContain(code);
  });

  it('يعيد دخول مدير نسي رمزه مرة واحدة ثم يُبطَل', async () => {
    const admin = await adminId();
    await db.users.update(admin, { pin: await hashPin('4444') });
    setSessionUser({ id: admin, name: 'المدير', role: 'admin' });
    const code = await generateRecoveryCode();
    setSessionUser(null);

    expect(await resetPinWithRecoveryCode('000000000000', admin, '1357', '1357')).toMatchObject({ ok: false, reason: 'invalid-code' });
    expect(await resetPinWithRecoveryCode(formatRecoveryCode(code), admin, '1357', '9999')).toEqual({ ok: false, reason: 'pin-mismatch' });
    const result = await resetPinWithRecoveryCode(formatRecoveryCode(code), admin, '1357', '1357');
    expect(result.ok).toBe(true);
    expect(getSessionUser()?.id).toBe(admin);
    expect(await verifyPin('1357', (await db.users.get(admin))?.pin ?? '')).toBe(true);
    expect(await hasRecoveryCode()).toBe(false);
    // الرمز لا يعمل مرة ثانية
    expect(await resetPinWithRecoveryCode(code, admin, '2468', '2468')).toEqual({ ok: false, reason: 'no-code' });
  });

  it('لا يُستخدم لتعيين رمز موظف مبيعات', async () => {
    setSessionUser({ id: await adminId(), name: 'المدير', role: 'admin' });
    const code = await generateRecoveryCode();
    const salesId = await addSales();
    expect(await resetPinWithRecoveryCode(code, salesId, '1357', '1357')).toEqual({ ok: false, reason: 'not-admin' });
  });
});

describe('مصفوفة الصلاحيات', () => {
  it('المدير يملك كل شيء، وموظف المبيعات للبيع فقط', () => {
    for (const permission of ALL_PERMISSIONS) expect(roleCan('admin', permission)).toBe(true);
    const sales = ALL_PERMISSIONS.filter((permission) => roleCan('sales', permission)).sort();
    expect(sales).toEqual(
      [
        'customers.create',
        'customers.view',
        'dashboard.view',
        'invoices.view',
        'materials.view',
        'notifications.view',
        'payments.create',
        'payments.view',
        'sales.create'
      ].sort()
    );
    expect(roleCan(undefined, 'dashboard.view')).toBe(false);
  });

  it('كل مسار مرتبط بصلاحيته', () => {
    expect(routePermission('/')).toBe('dashboard.view');
    expect(routePermission('/invoices/new')).toBe('sales.create');
    expect(routePermission('/invoices/12')).toBe('invoices.view');
    expect(routePermission('/invoices/12/edit')).toBe('invoices.edit');
    expect(routePermission('/payments/new')).toBe('payments.create');
    expect(routePermission('/purchases/new')).toBe('purchases.manage');
    expect(routePermission('/reports')).toBe('reports.view');
    expect(routePermission('/backup')).toBe('backup.manage');
    expect(routePermission('/settings')).toBe('settings.manage');
    expect(routePermission('/customers/3')).toBe('customers.view');
  });
});

describe('طبقة البيانات ترفض العمليات الممنوعة لموظف المبيعات (دفاع ثانٍ)', () => {
  it('يبيع ويستلم تسديداً ويضيف زبوناً، ولا يعدّل ولا يحذف', async () => {
    const now = new Date().toISOString();
    const materialId = (await db.materials.add({ name: 'سماد', quantity: 50, salePrice: 1000, minQuantity: 1, createdAt: now, updatedAt: now })) as number;
    const salesId = await addSales();
    setSessionUser({ id: salesId, name: 'أحمد', role: 'sales' });

    const customer = await saveCustomer({ fullName: 'زبون جديد' });
    expect(customer.ok).toBe(true);
    const customerId = customer.ok ? customer.id : 0;

    const invoice = await saveInvoice({
      type: 'credit',
      customerId,
      customerName: 'زبون جديد',
      dateISO: now,
      discount: 0,
      paidAmount: 0,
      items: [{ materialId, materialName: 'سماد', quantity: 2, unitPrice: 1000 }]
    });
    expect(invoice.ok).toBe(true);
    const payment = await savePayment({ customerId, amount: 500, dateISO: now, method: 'cash' });
    expect(payment.ok).toBe(true);

    // السجل منسوب للموظف
    const log = await db.activityLogs.where('entityType').equals('invoice').last();
    expect(log?.userName).toBe('أحمد');

    const invoiceId = invoice.ok ? invoice.invoiceId : 0;
    await expect(deleteInvoice(invoiceId)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      saveInvoice({ id: invoiceId, type: 'credit', customerId, customerName: 'زبون جديد', dateISO: now, discount: 0, paidAmount: 0, items: [{ materialId, materialName: 'سماد', quantity: 1, unitPrice: 1 }] })
    ).rejects.toThrow('لا تملك صلاحية تنفيذ هذه العملية');
    await expect(saveCustomer({ fullName: 'تعديل' }, customerId)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteCustomer(customerId)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(createMaterial({ name: 'مادة', quantity: 1, salePrice: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deletePayment(payment.ok ? payment.payment.id as number : 0)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      savePurchase({ supplierName: 'مورد', dateISO: now, discount: 0, paymentMethod: 'cash', paidAmount: 0, items: [{ materialName: 'سماد', quantity: 1, purchasePrice: 1 }] })
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(exportBackupToFile()).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(saveSnapshot('manual')).rejects.toBeInstanceOf(PermissionDeniedError);
    // النسخ التلقائي مهمة نظام تعمل أياً كان المستخدم
    await expect(saveSnapshot('auto')).resolves.not.toBeUndefined();
  });
});
