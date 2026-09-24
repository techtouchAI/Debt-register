import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { LockScreen } from '@/components/auth/LockScreen';
import { BootBackHandler } from '@/components/BackNavigationHandler';
import { Toaster } from '@/components/ui/Toaster';
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost';
import { useSession } from '@/hooks/useSession';
import { syncSessionWith, tryAutoSignIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { currentRoutePath } from '@/lib/navigation';
import { reportError } from '@/lib/errors';
import { roleCan, routePermission } from '@/lib/permissions';
import { toast } from '@/lib/toast';

/**
 * بوابة الدخول: تعرض التطبيق فقط لمستخدم مسجّل.
 *
 *  - قفل الدخول غير مفعّل (مدير واحد برمز افتراضي) ⇒ دخول تلقائي كمدير.
 *  - مفعّل ⇒ شاشة الدخول (خارج الموجّه، مثل معالج التشغيل الأول، مع معالج
 *    رجوع يعرض تأكيد الخروج بدل إنهاء التطبيق).
 *  - بعد الدخول: إن كانت الصفحة الحالية غير مسموحة للمستخدم الجديد (موظف
 *    مبيعات بعد مدير كان في الإعدادات) يُحوَّل للرئيسية (`RouteGuard`).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const [autoChecked, setAutoChecked] = useState(false);

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    tryAutoSignIn()
      .catch((error) => reportError('AuthGate.autoSignIn', error, 'تعذّر التحقق من المستخدمين'))
      .finally(() => {
        if (!cancelled) setAutoChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (session) return <>{children}</>;

  if (!autoChecked) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 font-cairo">
        <BootBackHandler />
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="font-cairo">
      <BootBackHandler />
      <LockScreen />
      <ConfirmDialogHost />
      <Toaster />
    </div>
  );
}

/**
 * مزامنة الجلسة مع جدول المستخدمين (تعديل الاسم/الصلاحية يظهر فوراً، وحذف
 * المستخدم الحالي أو استعادة نسخة بلا حسابه يُنهي الجلسة).
 */
export function SessionSync() {
  const users = useLiveQuery(() => db.users.toArray(), []);
  useEffect(() => {
    if (users) syncSessionWith(users);
  }, [users]);
  return null;
}

/**
 * حراسة المسار الحالي حسب صلاحية المستخدم: صفحة غير مسموحة (رابط قديم، أو
 * صفحة كان فيها مستخدم سابق، أو رجوع في السجل إلى صفحة مدير) ⇒ استبدالها
 * بالرئيسية مع توضيح.
 *
 * المرجع هو **الرابط نفسه** (`currentRoutePath`) والتحقق يتم بعد كل رسم وعند
 * كل تغيّر في السجل — لا بمكوّن `<Navigate>` الذي لا يعيد التحويل إلا إذا تغيّرت
 * اعتمادياته: تحديثات الموجّه انتقالات React، فتنقّلٌ في السجل قد يتجاوز تحويلاً
 * معلّقاً إلى موقع مطابق لما هو مرسوم أصلاً، فلا تُعاد الرسمة ولا التحويل وتبقى
 * صفحة فارغة على مسار غير مسموح.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const allowed = roleCan(session?.role, routePermission(location.pathname));

  const enforce = useEffectEvent(() => {
    if (!session) return;
    if (roleCan(session.role, routePermission(currentRoutePath(location.pathname)))) return;
    toast.info('تم فتح الصفحة الرئيسية', 'الصفحة المطلوبة متاحة لمدير النظام فقط');
    navigate('/', { replace: true });
  });

  // بعد كل رسم (بلا مصفوفة اعتماديات عمداً): تحويل تجاوزه تنقّل آخر يُعاد إصداره
  useEffect(() => {
    enforce();
  });

  // تنقّل في السجل (رجوع/تقدّم، أو رابط مكتوب في المتصفح) قد لا يُعيد الرسم
  useEffect(() => {
    const onHistoryChange = () => enforce();
    window.addEventListener('popstate', onHistoryChange);
    return () => window.removeEventListener('popstate', onHistoryChange);
  }, []);

  return allowed ? <>{children}</> : null;
}
