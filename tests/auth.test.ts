import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  formatRecoveryCode,
  generateRecoveryCode,
  hasRecoveryCode,
  isLoginRequired,
  listLoginUsers,
  loginRequiredFor,
  resetPinWithRecoveryCode,
  signIn,
  signInWithoutPin,
  signOut,
  syncSessionWith,
  tryAutoSignIn
} from '@/lib/auth';
import { createUser, deleteUser, updateUser, UserRuleError, UserValidationError } from '@/lib/users';
import { getSessionUser, setSessionUser } from '@/lib/session';
import { hashPin, isHashedPin, verifyPin } from '@/lib/security';
import { ALL_PERMISSIONS, PermissionDeniedError, roleCan, routePermission } from '@/lib/permissions';

async function adminId(): Promise<number> {
  const admin = (await db.users.toArray()).find((user) => user.role === 'admin');
  if (!admin?.id) throw new Error('لم يُنشأ المدير');
  return admin.id;
}

async function addSales(name = 'أحمد', pin = '5678'): Promise<number> {
  return createUser({ name, role: 'sales', pin, confirmPin: pin });
}

describe('رمز الدخول الاختياري', () => {
  it('مدير وحيد بلا رمز يدخل تلقائياً ولا توجد قيمة افتراضية معروفة', async () => {
    const id = await adminId();
    expect((await db.users.get(id))?.pin).toBe('');
    expect(await isLoginRequired()).toBe(false);
    expect(await tryAutoSignIn()).toBe(true);
    expect(getSessionUser()).toMatchObject({ id, role: 'admin' });
  });

  it('تفعيل رمز مملّح يفتح شاشة الدخول ويمنع الدخول التلقائي', async () => {
    const id = await adminId();
    await updateUser(id, { name: 'المدير', role: 'admin', pin: '4321', confirmPin: '4321' });
    const [admin] = await listLoginUsers();
    expect(admin.hasPin).toBe(true);
    expect(loginRequiredFor([admin])).toBe(true);
    expect(await tryAutoSignIn()).toBe(false);
    expect((await signIn(id, '٤٣٢١')).ok).toBe(true);
    const stored = await db.users.get(id);
    expect(isHashedPin(stored?.pin)).toBe(true);
    expect(stored?.pin).not.toContain('4321');
  });

  it('يمكن تغيير الرمز ثم تعطيله صراحةً', async () => {
    const id = await adminId();
    await updateUser(id, { name: 'المدير', role: 'admin', pin: '4321', confirmPin: '4321' });
    await updateUser(id, { name: 'المدير', role: 'admin', pin: '9876', confirmPin: '9876' });
    expect((await signIn(id, '4321')).ok).toBe(false);
    expect((await signIn(id, '9876')).ok).toBe(true);
    await signOut();

    await updateUser(id, { name: 'المدير', role: 'admin', disablePin: true });
    expect((await db.users.get(id))?.pin).toBe('');
    expect(await isLoginRequired()).toBe(false);
    expect((await signInWithoutPin(id)).ok).toBe(true);
  });

  it('عدة مستخدمين تعرض اختيار الهوية حتى إن كان أحد الحسابات بلا رمز', async () => {
    const admin = await adminId();
    await addSales('سعاد', '2468');
    expect(await isLoginRequired()).toBe(true);
    expect(await tryAutoSignIn()).toBe(false);
    expect((await signInWithoutPin(admin)).ok).toBe(true);
  });
});

describe('الدخول برمز والإيقاف المؤقت', () => {
  it('يحوّل الرمز القديم النصي إلى بصمة بعد دخول ناجح', async () => {
    const id = await adminId();
    await db.users.update(id, { pin: '1357' });
    const result = await signIn(id, '١٣٥٧');
    expect(result.ok).toBe(true);
    const stored = await db.users.get(id);
    expect(isHashedPin(stored?.pin)).toBe(true);
    expect(await verifyPin('1357', stored?.pin ?? '')).toBe(true);
  });

  it('يوقف المحاولات الخاطئة مؤقتاً', async () => {
    const id = await adminId();
    await db.users.update(id, { pin: await hashPin('1357') });
    const start = Date.UTC(2026, 8, 24, 10, 0, 0);
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(await signIn(id, '0000', start)).toEqual({ ok: false, reason: 'invalid', remainingAttempts: MAX_FAILED_ATTEMPTS - attempt });
    }
    expect(await signIn(id, '0000', start)).toMatchObject({ ok: false, reason: 'locked' });
    expect(await signIn(id, '1357', start + 1)).toMatchObject({ ok: false, reason: 'locked' });
    expect((await signIn(id, '1357', start + LOCKOUT_MS + 1)).ok).toBe(true);
  });
});

describe('إدارة المستخدمين والاسترداد', () => {
  it('يحفظ رمز المستخدم كبصمة ويبقيه عند تعديل البيانات دون رمز جديد', async () => {
    const id = await addSales('منى', '9753');
    const created = await db.users.get(id);
    expect(isHashedPin(created?.pin)).toBe(true);
    await updateUser(id, { name: 'منى أحمد', role: 'sales' });
    expect((await db.users.get(id))?.pin).toBe(created?.pin);
  });

  it('يحمي آخر مدير وحساب المستخدم الحالي', async () => {
    const admin = await adminId();
    await expect(updateUser(admin, { name: 'المدير', role: 'sales' })).rejects.toBeInstanceOf(UserValidationError);
    await expect(deleteUser(admin)).rejects.toBeInstanceOf(UserRuleError);
    const salesId = await addSales();
    setSessionUser({ id: salesId, name: 'أحمد', role: 'sales' });
    await expect(deleteUser(admin)).rejects.toBeInstanceOf(PermissionDeniedError);
    setSessionUser({ id: admin, name: 'المدير', role: 'admin' });
    await expect(deleteUser(admin)).rejects.toThrow('لا يمكنك حذف حسابك');
  });

  it('رمز الاسترداد بصمة تستخدم مرة واحدة لتعيين رمز جديد للمدير', async () => {
    const admin = await adminId();
    setSessionUser({ id: admin, name: 'المدير', role: 'admin' });
    const code = await generateRecoveryCode();
    expect(formatRecoveryCode(code)).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(await hasRecoveryCode()).toBe(true);
    setSessionUser(null);
    expect((await resetPinWithRecoveryCode(code, admin, '1357', '1357')).ok).toBe(true);
    expect(await hasRecoveryCode()).toBe(false);
    expect(await verifyPin('1357', (await db.users.get(admin))?.pin ?? '')).toBe(true);
  });

  it('مصفوفة الصلاحيات لا تمنح صلاحية لمسار غير معرّف', () => {
    for (const permission of ALL_PERMISSIONS) expect(roleCan('admin', permission)).toBe(true);
    expect(routePermission('/legacy/removed-feature')).toBe('dashboard.view');
    expect(routePermission('/materials')).toBe('materials.view');
    expect(routePermission('/reports')).toBe('reports.view');
    expect(routePermission('/developer')).toBe('dashboard.view');
    expect(roleCan('sales', routePermission('/developer'))).toBe(true);
  });

  it('تزامن الجلسة يحذف الجلسة عند غياب الحساب', () => {
    setSessionUser({ id: 1, name: 'سعيد', role: 'sales' });
    syncSessionWith([]);
    expect(getSessionUser()).toBeNull();
  });
});
