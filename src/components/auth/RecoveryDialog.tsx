import { useEffect, useId, useState } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModalCloser } from '@/hooks/useModalCloser';
import { hasRecoveryCode, RECOVERY_CODE_LENGTH, resetPinWithRecoveryCode, type LoginUserSummary } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';

/**
 * "نسيت رمز الدخول؟" من شاشة الدخول.
 *
 *  - موظف المبيعات: يعيد المدير تعيين رمزه من الإعدادات.
 *  - المدير: يُدخل رمز الاسترداد (المحفوظ على ورقة عند إنشائه) ثم رمزاً جديداً
 *    مرتين، فيدخل مباشرة. رمز الاسترداد يُستخدم مرة واحدة.
 */
interface RecoveryDialogProps {
  user: LoginUserSummary;
  admins: LoginUserSummary[];
  onClose: () => void;
}

export function RecoveryDialog({ user, admins, onClose }: RecoveryDialogProps) {
  const titleId = useId();
  const [available, setAvailable] = useState<boolean | null>(user.role === 'admin' ? null : false);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useModalCloser(true, onClose, { label: 'استعادة الدخول' });

  useEffect(() => {
    if (user.role !== 'admin') return;
    let cancelled = false;
    hasRecoveryCode()
      .then((exists) => {
        if (!cancelled) setAvailable(exists);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.role]);

  const otherAdmins = admins.filter((admin) => admin.id !== user.id);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetPinWithRecoveryCode(code, user.id, pin, confirmPin);
      if (result.ok) {
        toast.success('تم تعيين رمز دخول جديد', 'رمز الاسترداد استُخدم — أنشئ رمزاً جديداً من الإعدادات واحفظه');
        onClose();
        return;
      }
      switch (result.reason) {
        case 'locked':
          setError(`محاولات خاطئة كثيرة — أعد المحاولة بعد ${Math.ceil(result.retryAfterMs / 1000)} ثانية`);
          break;
        case 'invalid-code':
          setError(`رمز الاسترداد غير صحيح — المحاولات المتبقية: ${result.remainingAttempts}`);
          break;
        case 'invalid-pin':
          setError('رمز الدخول الجديد يجب أن يكون من 4 إلى 8 أرقام');
          break;
        case 'pin-mismatch':
          setError('تأكيد الرمز الجديد غير مطابق');
          break;
        case 'no-code':
          setAvailable(false);
          break;
        default:
          setError('لا يمكن استعادة الدخول لهذا المستخدم');
      }
    } catch (failure) {
      reportError('RecoveryDialog.submit', failure, 'تعذّر استعادة الدخول');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 animate-slide-up"
      >
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 id={titleId} className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary-600" />
            استعادة الدخول
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {user.role !== 'admin' ? (
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            اطلب من مدير النظام إعادة تعيين رمزك من: <strong>الإعدادات ← إدارة المستخدمين ← تعديل</strong>.
          </p>
        ) : available === null ? (
          <div className="flex justify-center py-6 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !available ? (
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            <p>لم يُنشأ رمز استرداد لهذا المكتب بعد، أو استُخدم الرمز السابق.</p>
            {otherAdmins.length > 0 ? (
              <p>
                اطلب من مدير آخر ({otherAdmins.map((admin) => admin.name).join('، ')}) إعادة تعيين رمزك من الإعدادات ← إدارة المستخدمين.
              </p>
            ) : (
              <p>بعد الدخول أنشئ رمز استرداد من الإعدادات ← إدارة المستخدمين واحفظه في مكان آمن.</p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              أدخل رمز الاسترداد المكوّن من {RECOVERY_CODE_LENGTH} رقماً (الذي حفظته عند إنشائه)، ثم اختر رمز دخول جديداً للمستخدم {user.name}.
            </p>
            <div>
              <label className="text-sm font-medium mb-1 block" htmlFor={`${titleId}-code`}>رمز الاسترداد</label>
              <Input
                id={`${titleId}-code`}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="text-center tracking-widest"
                placeholder="0000-0000-0000"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium mb-1 block" htmlFor={`${titleId}-pin`}>الرمز الجديد</label>
                <Input id={`${titleId}-pin`} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block" htmlFor={`${titleId}-confirm`}>تأكيد الرمز</label>
                <Input id={`${titleId}-confirm`} type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} />
              </div>
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 font-medium" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              تعيين الرمز والدخول
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
