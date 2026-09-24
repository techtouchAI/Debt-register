/**
 * جلسة المستخدم الحالي (في الذاكرة فقط).
 *
 * وحدة بلا أي اعتماديات عمداً: تستوردها طبقة البيانات (لنسب سجل النشاط إلى
 * المستخدم وللتحقق من الصلاحيات) وتستوردها وحدة الدخول، دون حلقة استيراد.
 *
 * الجلسة لا تُحفظ على القرص: إعادة تشغيل التطبيق تتطلب الدخول من جديد عندما
 * يكون قفل الدخول مفعّلاً (نفس سلوك تطبيقات نقاط البيع).
 *
 * "بلا جلسة" = سياق النظام: المهام الخلفية (النسخ التلقائي، الصيانة، تنبيهات
 * المخزون) تعمل دون مستخدم، والواجهة لا تُعرض أبداً بلا جلسة، لذلك لا تُمنع
 * العمليات عند غياب الجلسة، وتُمنع فقط عندما يكون المستخدم المسجّل لا يملك
 * الصلاحية.
 */
import { PermissionDeniedError, roleCan, type Permission, type Role } from './permissions';

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
}

let current: SessionUser | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('تعذّر تحديث مستمع الجلسة:', error);
    }
  }
}

export function getSessionUser(): SessionUser | null {
  return current;
}

export function setSessionUser(user: SessionUser | null): void {
  const next = user ? { id: user.id, name: user.name, role: user.role } : null;
  if (
    current === next ||
    (current && next && current.id === next.id && current.name === next.name && current.role === next.role)
  ) {
    return;
  }
  current = next;
  emit();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** هل يملك المستخدم الحالي الصلاحية؟ (بلا جلسة = لا شيء يُعرض، فتُعاد false) */
export function sessionCan(permission: Permission): boolean {
  return current !== null && roleCan(current.role, permission);
}

/**
 * التحقق في طبقة البيانات (دفاع ثانٍ خلف إخفاء الأزرار وحراسة المسارات).
 * يرمي `PermissionDeniedError` برسالة عربية إن كان المستخدم المسجّل لا يملك
 * الصلاحية. بلا جلسة (مهام النظام الخلفية) يُسمح.
 */
export function assertPermission(permission: Permission): void {
  if (current && !roleCan(current.role, permission)) throw new PermissionDeniedError(permission);
}

/** إعادة الجلسة لحالتها الأولى — للاختبارات فقط. */
export function resetSessionForTests(): void {
  current = null;
  emit();
}
