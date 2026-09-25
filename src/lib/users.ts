/**
 * إدارة المستخدمين (إضافة / تعديل / حذف) — قواعد العمل في مكان واحد.
 *
 * كانت العمليات مكتوبة داخل صفحة الإعدادات مباشرة على قاعدة البيانات، بلا
 * تحقق من تكرار الاسم ولا تأكيد للرمز، ولم يكن للمستخدمين أي أثر في التطبيق.
 * الآن: تحقق كامل برسائل عربية لكل حقل، حماية آخر مدير وحساب المستخدم
 * الحالي، وتحقق من صلاحية "إدارة المستخدمين" في طبقة البيانات نفسها.
 */
import { db, logActivity } from './db';
import { hashPin, isValidPin, normalizePin } from './security';
import { assertPermission, getSessionUser, setSessionUser } from './session';
import { logBackgroundFailure } from './lifecycle';
import { roleLabel } from './labels';
import type { Role } from './permissions';
import type { User } from '@/types';

export const MAX_USER_NAME_LENGTH = 60;

export interface UserInput {
  name: string;
  role: Role;
  /** فارغ = عدم إنشاء رمز جديد؛ عند التعديل يبقي الرمز الحالي ما لم يعطّل صراحةً. */
  pin?: string;
  confirmPin?: string;
  /** تعطيل PIN لحساب موجود؛ لا يقبل مع رمز جديد. */
  disablePin?: boolean;
}

export type UserField = 'name' | 'role' | 'pin' | 'confirmPin' | 'disablePin';
export type UserErrors = Partial<Record<UserField, string>>;

/** خطأ تحقق يحمل رسالة لكل حقل (يُعرض تحت الحقل في النموذج). */
export class UserValidationError extends Error {
  readonly errors: UserErrors;
  constructor(errors: UserErrors) {
    super(Object.values(errors)[0] ?? 'بيانات المستخدم غير صالحة');
    this.name = 'UserValidationError';
    this.errors = errors;
  }
}

/** خطأ قاعدة عمل (حذف آخر مدير، حذف الحساب الحالي...). */
export class UserRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserRuleError';
  }
}

export function normalizeUserName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

const nameKey = (name: string) => normalizeUserName(name).toLocaleLowerCase('ar');

interface ValidatedUser {
  name: string;
  role: Role;
  pin?: string;
}

/** التحقق من بيانات المستخدم (تُستخدم في النموذج قبل الحفظ وفي الحفظ نفسه). */
export async function validateUserInput(input: UserInput, editingId?: number): Promise<{ ok: true; value: ValidatedUser } | { ok: false; errors: UserErrors }> {
  const errors: UserErrors = {};
  const name = normalizeUserName(input.name);
  if (!name) errors.name = 'اسم المستخدم مطلوب';
  else if (name.length > MAX_USER_NAME_LENGTH) errors.name = `اسم المستخدم طويل جداً (الحد ${MAX_USER_NAME_LENGTH} حرفاً)`;
  else {
    const users = await db.users.toArray();
    if (users.some((user) => user.id !== editingId && nameKey(user.name) === nameKey(name))) {
      errors.name = 'يوجد مستخدم آخر بالاسم نفسه — اختر اسماً مختلفاً';
    }
  }

  const role: Role | null = input.role === 'admin' || input.role === 'sales' ? input.role : null;
  if (!role) errors.role = 'اختر صلاحية المستخدم';

  const pin = normalizePin(input.pin ?? '');
  const confirmPin = normalizePin(input.confirmPin ?? '');
  if (input.disablePin && pin) {
    errors.pin = 'امسح الرمز الجديد قبل تعطيل الحماية';
  } else if (pin && !isValidPin(pin)) {
    errors.pin = 'رمز الدخول يجب أن يكون من 4 إلى 8 أرقام فقط';
  } else if (pin !== confirmPin) {
    errors.confirmPin = 'تأكيد الرمز غير مطابق';
  }

  if (Object.keys(errors).length > 0 || !role) return { ok: false, errors };
  return { ok: true, value: { name, role, pin: pin || undefined } };
}

function adminCount(users: User[]): number {
  return users.filter((user) => user.role === 'admin').length;
}

/** إضافة مستخدم جديد. يُعيد معرّفه. */
export async function createUser(input: UserInput): Promise<number> {
  assertPermission('users.manage');
  const validation = await validateUserInput(input);
  if (!validation.ok) throw new UserValidationError(validation.errors);
  const { name, role, pin } = validation.value;
  const pinHash = pin ? await hashPin(pin) : '';
  const id = (await db.users.add({ name, role, pin: pinHash, createdAt: new Date().toISOString() })) as number;
  void logActivity('إضافة مستخدم', `تمت إضافة المستخدم ${name} (${roleLabel(role)})`, 'user', id).catch((error) =>
    logBackgroundFailure('تعذّر تسجيل إضافة المستخدم:', error)
  );
  return id;
}

/** تعديل مستخدم (الاسم/الصلاحية، والرمز إن أُدخل رمز جديد). */
export async function updateUser(id: number, input: UserInput): Promise<void> {
  assertPermission('users.manage');
  const existing = await db.users.get(id);
  if (!existing) throw new UserRuleError('المستخدم غير موجود');

  const validation = await validateUserInput(input, id);
  if (!validation.ok) throw new UserValidationError(validation.errors);
  const { name, role, pin } = validation.value;

  if (existing.role === 'admin' && role !== 'admin' && adminCount(await db.users.toArray()) <= 1) {
    throw new UserValidationError({ role: 'يجب بقاء مدير واحد على الأقل في النظام' });
  }

  const pinHash = pin ? await hashPin(pin) : undefined;
  await db.users.update(id, { name, role, ...(pinHash ? { pin: pinHash } : input.disablePin ? { pin: '' } : {}) });

  // الجلسة الحالية تتحدّث فوراً (الاسم في الشريط العلوي، والصلاحيات)
  const session = getSessionUser();
  if (session?.id === id) setSessionUser({ id, name, role });

  const changes = [
    existing.name !== name ? `الاسم إلى ${name}` : '',
    existing.role !== role ? `الصلاحية إلى ${roleLabel(role)}` : '',
    pinHash ? 'رمز الدخول' : input.disablePin ? 'تعطيل رمز الدخول' : ''
  ].filter(Boolean);
  void logActivity('تعديل مستخدم', `تعديل المستخدم ${existing.name}${changes.length ? `: ${changes.join('، ')}` : ''}`, 'user', id).catch(
    (error) => logBackgroundFailure('تعذّر تسجيل تعديل المستخدم:', error)
  );
}

/** حذف مستخدم مع حماية آخر مدير وآخر مستخدم وحساب المستخدم الحالي. */
export async function deleteUser(id: number): Promise<void> {
  assertPermission('users.manage');
  const users = await db.users.toArray();
  const target = users.find((user) => user.id === id);
  if (!target) throw new UserRuleError('المستخدم غير موجود');
  if (getSessionUser()?.id === id) throw new UserRuleError('لا يمكنك حذف حسابك وأنت مسجّل الدخول به');
  if (users.length <= 1) throw new UserRuleError('يجب بقاء مستخدم واحد على الأقل');
  if (target.role === 'admin' && adminCount(users) <= 1) throw new UserRuleError('يجب بقاء مدير واحد على الأقل في النظام');

  await db.users.delete(id);
  void logActivity('حذف مستخدم', `تم حذف المستخدم ${target.name}`, 'user', id).catch((error) =>
    logBackgroundFailure('تعذّر تسجيل حذف المستخدم:', error)
  );
}
