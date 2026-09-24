import { useCallback, useSyncExternalStore } from 'react';
import { getSessionUser, subscribeSession, type SessionUser } from '@/lib/session';
import { roleCan, type Permission } from '@/lib/permissions';

/** المستخدم المسجّل حالياً (يتحدّث فوراً عند الدخول/الخروج/تعديل الحساب). */
export function useSession(): SessionUser | null {
  return useSyncExternalStore(subscribeSession, getSessionUser, getSessionUser);
}

/**
 * دالة فحص الصلاحيات للمستخدم الحالي — لإظهار/إخفاء الأزرار والأقسام.
 * (طبقة البيانات تتحقق أيضاً، فالإخفاء هنا لتجربة الاستخدام لا للحماية وحدها)
 */
export function usePermission(): (permission: Permission) => boolean {
  const session = useSession();
  const role = session?.role;
  return useCallback((permission: Permission) => roleCan(role, permission), [role]);
}
