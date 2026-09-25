/**
 * الدخول برمز (PIN) — نظام محلي بالكامل بلا إنترنت.
 *
 * متى يُطلب الدخول؟ (قفل الدخول)
 *   - إذا فُعّل رمز دخول لأي مستخدم، أو وُجد أكثر من مستخدم لاختيار الهوية.
 *   - مدير وحيد بلا رمز يدخل مباشرة، بلا رمز افتراضي أو حاجز إجباري.
 *   - يمكن لكل حساب تعطيل رمزه صراحةً؛ لا نخزّن رمزاً فارغاً أو معروفاً كبديل.
 *
 * الحماية:
 *   - الرموز محفوظة كبصمات SHA-256 مملّحة (`security.ts`)، والرموز القديمة
 *     النصية تُحوَّل لبصمة عند أول دخول ناجح.
 *   - 5 محاولات خاطئة متتالية ⇒ إيقاف مؤقت 30 ثانية (يبقى بعد إعادة التشغيل).
 *   - رمز استرداد (12 رقماً) يُنشئه المدير ويحفظه على ورقة، يسمح بتعيين رمز
 *     جديد لمدير نسي رمزه — يُستخدم مرة واحدة ثم يُبطَل.
 */
import { db, getMeta, logActivity, setMeta } from './db';
import { hashPin, isHashedPin, isValidPin, normalizePin, verifyPin } from './security';
import { assertPermission, getSessionUser, setSessionUser, type SessionUser } from './session';
import { AUTH_META_PREFIX } from './metaKeys';
import { logBackgroundFailure } from './lifecycle';
import type { Role } from './permissions';
import type { User } from '@/types';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 30_000;
/** مفتاح بصمة رمز الاسترداد في جدول meta (ينتقل مع النسخة الاحتياطية). */
export const RECOVERY_META_KEY = `${AUTH_META_PREFIX}recovery`;
const LOCKOUT_STORAGE_KEY = 'auth-lockout';
const LAST_USER_STORAGE_KEY = 'auth-last-user';
export const RECOVERY_CODE_LENGTH = 12;

export interface LoginUserSummary {
  id: number;
  name: string;
  role: Role;
  /** هل لهذا الحساب رمز دخول مفعّل ومحفوظ كبصمة؟ */
  hasPin: boolean;
  lastLogin?: string;
}

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid'; remainingAttempts: number }
  | { ok: false; reason: 'locked'; retryAfterMs: number }
  | { ok: false; reason: 'not-found' | 'invalid-pin-format' };

/* ------------------------------------------------------------------ *
 * المستخدمون وقرار القفل
 * ------------------------------------------------------------------ */

function toSessionUser(user: User): SessionUser {
  return { id: user.id as number, name: user.name, role: user.role === 'admin' ? 'admin' : 'sales' };
}

/** هل للحساب رمز دخول مفعّل؟ الرمز نفسه لا يخرج من طبقة الأمان. */
export function hasConfiguredPin(storedPin: string | undefined): boolean {
  return typeof storedPin === 'string' && storedPin.length > 0;
}

/** المستخدمون كما تعرضهم شاشة الدخول (المدراء أولاً ثم أبجدياً). */
export async function listLoginUsers(): Promise<LoginUserSummary[]> {
  const users = (await db.users.toArray()).filter((user): user is User & { id: number } => typeof user.id === 'number');
  const summaries = await Promise.all(
    users.map(async (user) => ({
      id: user.id,
      name: user.name,
      role: (user.role === 'admin' ? 'admin' : 'sales') as Role,
      hasPin: hasConfiguredPin(user.pin),
      lastLogin: user.lastLogin
    }))
  );
  return summaries.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, 'ar') : a.role === 'admin' ? -1 : 1));
}

/** هل يجب عرض شاشة الدخول؟ */
export function loginRequiredFor(users: readonly Pick<LoginUserSummary, 'hasPin'>[]): boolean {
  return users.length > 1 || users.some((user) => user.hasPin);
}

export async function isLoginRequired(): Promise<boolean> {
  return loginRequiredFor(await listLoginUsers());
}

/**
 * دخول تلقائي عندما لا يكون القفل مفعّلاً (حساب وحيد بلا PIN).
 * @returns true إن تم الدخول (أو كانت هناك جلسة أصلاً).
 */
export async function tryAutoSignIn(): Promise<boolean> {
  if (getSessionUser()) return true;
  const users = await listLoginUsers();
  if (loginRequiredFor(users)) return false;
  const admin = users.find((user) => user.role === 'admin') ?? users[0];
  if (!admin || admin.hasPin) return false;
  const record = await db.users.get(admin.id);
  if (!record || typeof record.id !== 'number') return false;
  // "آخر دخول" صحيح في قائمة المستخدمين حتى مع الدخول التلقائي (بلا سجل
  // نشاط في كل تشغيل — لا ضوضاء)
  await db.users
    .update(record.id, { lastLogin: new Date().toISOString() })
    .catch((error) => logBackgroundFailure('تعذّر تسجيل آخر دخول:', error));
  setSessionUser(toSessionUser(record));
  return true;
}

/* ------------------------------------------------------------------ *
 * الإيقاف المؤقت بعد المحاولات الخاطئة
 * ------------------------------------------------------------------ */

interface LockoutState {
  failures: number;
  lockedUntil: number;
}

let memoryLockout: LockoutState = { failures: 0, lockedUntil: 0 };

function readLockout(): LockoutState {
  try {
    const raw = window.localStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LockoutState>;
      return {
        failures: Number.isFinite(parsed.failures) ? Number(parsed.failures) : 0,
        lockedUntil: Number.isFinite(parsed.lockedUntil) ? Number(parsed.lockedUntil) : 0
      };
    }
  } catch {
    /* التخزين المحلي غير متاح — نعتمد على الذاكرة */
  }
  return memoryLockout;
}

function writeLockout(state: LockoutState): void {
  memoryLockout = state;
  try {
    window.localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** المدة المتبقية للإيقاف المؤقت (0 = غير موقوف). */
export function lockoutRemainingMs(now: number = Date.now()): number {
  return Math.max(0, readLockout().lockedUntil - now);
}

function registerFailure(now: number): { locked: boolean; remaining: number } {
  const state = readLockout();
  const failures = state.failures + 1;
  if (failures >= MAX_FAILED_ATTEMPTS) {
    writeLockout({ failures: 0, lockedUntil: now + LOCKOUT_MS });
    return { locked: true, remaining: 0 };
  }
  writeLockout({ failures, lockedUntil: state.lockedUntil });
  return { locked: false, remaining: MAX_FAILED_ATTEMPTS - failures };
}

function clearFailures(): void {
  writeLockout({ failures: 0, lockedUntil: 0 });
}

/* ------------------------------------------------------------------ *
 * الدخول والخروج
 * ------------------------------------------------------------------ */

export function rememberLastUser(userId: number): void {
  try {
    window.localStorage.setItem(LAST_USER_STORAGE_KEY, String(userId));
  } catch {
    /* ignore */
  }
}

export function lastSignedInUserId(): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_USER_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function completeSignIn(user: User & { id: number }, now: number, upgradedPin?: string): Promise<SignInResult> {
  clearFailures();
  const lastLogin = new Date(now).toISOString();
  await db.users.update(user.id, { lastLogin, ...(upgradedPin ? { pin: upgradedPin } : {}) });
  const session = toSessionUser(user);
  setSessionUser(session);
  rememberLastUser(user.id);
  void logActivity('تسجيل دخول', `دخل المستخدم: ${user.name}`, 'user', user.id).catch((error) =>
    logBackgroundFailure('تعذّر تسجيل الدخول في سجل النشاط:', error)
  );
  return { ok: true, user: session };
}

export async function signIn(userId: number, rawPin: string, now: number = Date.now()): Promise<SignInResult> {
  const remaining = lockoutRemainingMs(now);
  if (remaining > 0) return { ok: false, reason: 'locked', retryAfterMs: remaining };

  const pin = normalizePin(rawPin);
  if (!isValidPin(pin)) return { ok: false, reason: 'invalid-pin-format' };
  const user = await db.users.get(userId);
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'not-found' };
  if (!hasConfiguredPin(user.pin)) return { ok: false, reason: 'invalid' as const, remainingAttempts: MAX_FAILED_ATTEMPTS };

  const valid = await verifyPin(pin, user.pin);
  if (!valid) {
    const failure = registerFailure(now);
    if (failure.locked) {
      void logActivity('إيقاف مؤقت للدخول', `محاولات دخول خاطئة متتالية للمستخدم: ${user.name}`, 'user', user.id).catch(
        (error) => logBackgroundFailure('تعذّر تسجيل إيقاف الدخول:', error)
      );
      return { ok: false, reason: 'locked', retryAfterMs: LOCKOUT_MS };
    }
    return { ok: false, reason: 'invalid', remainingAttempts: failure.remaining };
  }

  // رمز قديم محفوظ نصاً: يُحوَّل لبصمة بعد التحقق منه.
  const upgradedPin = isHashedPin(user.pin) ? undefined : await hashPin(pin);
  return completeSignIn({ ...user, id: user.id }, now, upgradedPin);
}

/** دخول اختياري بلا رمز لحساب تعطّلت حمايته صراحةً. */
export async function signInWithoutPin(userId: number, now: number = Date.now()): Promise<SignInResult> {
  const remaining = lockoutRemainingMs(now);
  if (remaining > 0) return { ok: false, reason: 'locked', retryAfterMs: remaining };
  const user = await db.users.get(userId);
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'not-found' };
  if (hasConfiguredPin(user.pin)) return { ok: false, reason: 'invalid', remainingAttempts: MAX_FAILED_ATTEMPTS };
  return completeSignIn({ ...user, id: user.id }, now);
}

/** تسجيل الخروج (قفل الشاشة / تبديل المستخدم). */
export async function signOut(): Promise<void> {
  const user = getSessionUser();
  if (!user) return;
  await logActivity('تسجيل خروج', `خرج المستخدم: ${user.name}`, 'user', user.id).catch((error) =>
    logBackgroundFailure('تعذّر تسجيل الخروج في سجل النشاط:', error)
  );
  setSessionUser(null);
}

/**
 * مزامنة الجلسة مع قاعدة البيانات بعد تعديل المستخدمين أو استعادة نسخة:
 * تغيّر الاسم/الصلاحية يظهر فوراً، وحذف المستخدم الحالي يُنهي جلسته.
 */
export function syncSessionWith(users: readonly User[]): void {
  const session = getSessionUser();
  if (!session) return;
  const record = users.find((user) => user.id === session.id);
  if (!record) {
    setSessionUser(null);
    return;
  }
  setSessionUser(toSessionUser(record));
}

/* ------------------------------------------------------------------ *
 * رمز الاسترداد
 * ------------------------------------------------------------------ */

interface RecoveryRecord {
  hash: string;
  createdAt: string;
}

function onlyDigits(value: string): string {
  return normalizePin(value).replace(/\D+/g, '');
}

/** تنسيق رمز الاسترداد للعرض: 1234-5678-9012 */
export function formatRecoveryCode(code: string): string {
  return onlyDigits(code).replace(/(\d{4})(?=\d)/g, '$1-');
}

function randomDigits(length: number): string {
  const digits: number[] = [];
  const buffer = new Uint8Array(length * 2);
  while (digits.length < length) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buffer);
    else for (let i = 0; i < buffer.length; i += 1) buffer[i] = Math.floor(Math.random() * 256);
    for (const byte of buffer) {
      // رفض القيم ≥ 250 يمنع انحياز باقي القسمة على 10
      if (byte < 250) digits.push(byte % 10);
      if (digits.length === length) break;
    }
  }
  return digits.join('');
}

export async function hasRecoveryCode(): Promise<boolean> {
  const record = await getMeta<RecoveryRecord>(RECOVERY_META_KEY);
  return Boolean(record && typeof record.hash === 'string' && record.hash);
}

/**
 * إنشاء رمز استرداد جديد (يُبطل السابق). يُعاد الرمز مرة واحدة فقط للعرض —
 * المحفوظ بصمته لا الرمز نفسه.
 */
export async function generateRecoveryCode(): Promise<string> {
  assertPermission('users.manage');
  const code = randomDigits(RECOVERY_CODE_LENGTH);
  await setMeta(RECOVERY_META_KEY, { hash: await hashPin(code), createdAt: new Date().toISOString() } satisfies RecoveryRecord);
  const user = getSessionUser();
  void logActivity('إنشاء رمز استرداد', `أنشأ ${user?.name ?? 'المدير'} رمز استرداد جديداً`, 'user', user?.id).catch(
    (error) => logBackgroundFailure('تعذّر تسجيل رمز الاسترداد:', error)
  );
  return code;
}

export type RecoveryResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'locked'; retryAfterMs: number }
  | { ok: false; reason: 'invalid-code'; remainingAttempts: number }
  | { ok: false; reason: 'no-code' | 'not-admin' | 'invalid-pin' | 'pin-mismatch' };

/**
 * تعيين رمز جديد لمدير نسي رمزه باستخدام رمز الاسترداد، ثم الدخول به.
 * رمز الاسترداد يُبطَل بعد الاستخدام (يُنشئ المدير رمزاً جديداً لاحقاً).
 */
export async function resetPinWithRecoveryCode(
  code: string,
  userId: number,
  newPin: string,
  confirmPin: string,
  now: number = Date.now()
): Promise<RecoveryResult> {
  const remaining = lockoutRemainingMs(now);
  if (remaining > 0) return { ok: false, reason: 'locked', retryAfterMs: remaining };

  const record = await getMeta<RecoveryRecord>(RECOVERY_META_KEY);
  if (!record?.hash) return { ok: false, reason: 'no-code' };

  const user = await db.users.get(userId);
  if (!user || user.role !== 'admin' || typeof user.id !== 'number') return { ok: false, reason: 'not-admin' };

  const valid = onlyDigits(code).length === RECOVERY_CODE_LENGTH && (await verifyPin(onlyDigits(code), record.hash));
  if (!valid) {
    const failure = registerFailure(now);
    if (failure.locked) return { ok: false, reason: 'locked', retryAfterMs: LOCKOUT_MS };
    return { ok: false, reason: 'invalid-code', remainingAttempts: failure.remaining };
  }

  if (!isValidPin(newPin)) return { ok: false, reason: 'invalid-pin' };
  if (normalizePin(newPin) !== normalizePin(confirmPin)) return { ok: false, reason: 'pin-mismatch' };

  clearFailures();
  const lastLogin = new Date(now).toISOString();
  // البصمة تُحسب قبل المعاملة: انتظار واجهة غير IndexedDB داخل معاملة Dexie
  // يُنهي المعاملة مبكراً (TransactionInactiveError)
  const pinHash = await hashPin(normalizePin(newPin));
  await db.transaction('rw', [db.users, db.meta], async () => {
    await db.users.update(user.id as number, { pin: pinHash, lastLogin });
    await db.meta.delete(RECOVERY_META_KEY);
  });

  const session = toSessionUser(user);
  setSessionUser(session);
  rememberLastUser(user.id);
  void logActivity('استعادة الدخول', `عيّن ${user.name} رمز دخول جديداً باستخدام رمز الاسترداد`, 'user', user.id).catch(
    (error) => logBackgroundFailure('تعذّر تسجيل استعادة الدخول:', error)
  );
  return { ok: true, user: session };
}
