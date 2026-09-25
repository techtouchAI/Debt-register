import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Delete, KeyRound, Loader2, LockKeyhole, LogIn, Shield, UserRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OverflowMarquee } from '@/components/ui/OverflowMarquee';
import { RecoveryDialog } from '@/components/auth/RecoveryDialog';
import { useModalCloser } from '@/hooks/useModalCloser';
import { useOfficeSettings } from '@/hooks/useOfficeSettings';
import {
  lastSignedInUserId,
  listLoginUsers,
  lockoutRemainingMs,
  signIn,
  signInWithoutPin,
  type LoginUserSummary
} from '@/lib/auth';
import { roleLabel } from '@/lib/labels';
import { toLatinDigits } from '@/lib/digits';
import { reportError } from '@/lib/errors';
import { formatDate } from '@/lib/utils';

/**
 * شاشة الدخول (قفل التطبيق).
 *
 * تعمل بنفس الطريقة على كل المنصات:
 *   - أندرويد (لمس): لوحة أرقام كبيرة على الشاشة — لا تظهر لوحة مفاتيح النظام.
 *   - ويندوز (فأرة ولوحة مفاتيح): النقر على لوحة الأرقام، أو الكتابة مباشرة
 *     بأرقام لوحة المفاتيح (العربية أو الإنجليزية) + Enter للدخول و Backspace
 *     للمسح و Escape للعودة لاختيار المستخدم.
 *   - زر الرجوع (أندرويد/الفأرة) يعود من إدخال الرمز إلى قائمة المستخدمين.
 */
const MAX_PIN_LENGTH = 8;
const MIN_PIN_LENGTH = 4;

export function LockScreen() {
  const settings = useOfficeSettings();
  const officeName = settings?.officeName?.trim() || 'إدارة المكتب';
  const logo = settings?.logo?.trim() || '';

  const [users, setUsers] = useState<LoginUserSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [lockRemaining, setLockRemaining] = useState(() => lockoutRemainingMs());
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listLoginUsers()
      .then((list) => {
        if (cancelled) return;
        setUsers(list);
        // مستخدم واحد، أو آخر من دخل: نختاره مباشرة لتوفير نقرة
        const last = lastSignedInUserId();
        const preselect = list.length === 1 ? list[0].id : list.find((user) => user.id === last)?.id ?? null;
        setSelectedId(preselect);
      })
      .catch((failure) => {
        if (!cancelled) reportError('LockScreen.users', failure, 'تعذّر تحميل المستخدمين');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => users?.find((user) => user.id === selectedId) ?? null, [users, selectedId]);
  const locked = lockRemaining > 0;

  // عدّاد الإيقاف المؤقت
  useEffect(() => {
    if (!locked) return;
    const timer = window.setInterval(() => setLockRemaining(lockoutRemainingMs()), 500);
    return () => window.clearInterval(timer);
  }, [locked]);

  const backToUsers = useCallback(() => {
    setSelectedId(null);
    setPin('');
    setError(null);
  }, []);

  // إدخال الرمز طبقة يُغلقها الرجوع/Escape (إن وُجد أكثر من مستخدم للاختيار)
  useModalCloser(Boolean(selected) && (users?.length ?? 0) > 1 && !recoveryOpen, backToUsers, { label: 'إدخال رمز الدخول' });

  const submit = useCallback(async () => {
    if (!selected || busy || locked) return;
    if (selected.hasPin && pin.length < MIN_PIN_LENGTH) {
      setError(`رمز الدخول من ${MIN_PIN_LENGTH} إلى ${MAX_PIN_LENGTH} أرقام`);
      return;
    }
    setBusy(true);
    try {
      const result = selected.hasPin ? await signIn(selected.id, pin) : await signInWithoutPin(selected.id);
      if (result.ok) return; // الجلسة تتغيّر ⇒ يُعرض التطبيق مكان هذه الشاشة
      setPin('');
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      if (result.reason === 'locked') {
        setLockRemaining(result.retryAfterMs);
        setError('محاولات خاطئة كثيرة — أُوقف الدخول مؤقتاً');
      } else if (result.reason === 'invalid') {
        setError(`رمز الدخول غير صحيح — المحاولات المتبقية: ${result.remainingAttempts}`);
      } else if (result.reason === 'not-found') {
        setError('المستخدم غير موجود');
      } else {
        setError(`رمز الدخول من ${MIN_PIN_LENGTH} إلى ${MAX_PIN_LENGTH} أرقام`);
      }
    } catch (failure) {
      reportError('LockScreen.signIn', failure, 'تعذّر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }, [selected, busy, locked, pin]);

  const pressDigit = useCallback(
    (digit: string) => {
      if (locked || busy) return;
      setError(null);
      setPin((current) => (current.length >= MAX_PIN_LENGTH ? current : current + digit));
    },
    [locked, busy]
  );

  const pressBackspace = useCallback(() => {
    setError(null);
    setPin((current) => current.slice(0, -1));
  }, []);

  // لوحة المفاتيح (ويندوز): أرقام عربية أو إنجليزية، Enter، Backspace
  useEffect(() => {
    if (!selected || !selected.hasPin || recoveryOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const key = toLatinDigits(event.key);
      if (/^\d$/.test(key)) {
        event.preventDefault();
        pressDigit(key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        pressBackspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, recoveryOpen, pressDigit, pressBackspace, submit]);

  const lockSeconds = Math.ceil(lockRemaining / 1000);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 font-cairo" dir="rtl">
      <Card className="w-full max-w-md border-0 shadow-2xl overflow-hidden animate-slide-up">
        <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 dark:from-black dark:to-gray-900 px-6 py-6 text-white text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center mx-auto mb-3 overflow-hidden">
            {logo ? <img src={logo} alt="شعار المكتب" className="w-full h-full object-cover" /> : <LockKeyhole className="w-7 h-7" />}
          </div>
          <OverflowMarquee as="h1" text={officeName} className="text-lg font-bold" data-testid="lock-office-name" />
          <p className="text-xs text-white/70 mt-1">تسجيل الدخول إلى المكتب</p>
        </div>

        <CardContent className="p-5 sm:p-6">
          {users === null ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : !selected ? (
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">اختر المستخدم</h2>
              {/* قائمة حقيقية (ul/li) وكل عنصر زر فعلي: قارئ الشاشة يعلن «زر» لا «عنصر قائمة» فقط */}
              <ul className="space-y-2 max-h-[55vh] overflow-y-auto overscroll-contain" role="list" aria-label="المستخدمون">
                {users.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(user.id);
                        setPin('');
                        setError(null);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-400 hover:bg-primary-50/60 dark:hover:bg-primary-900/10 transition-colors text-right cursor-pointer"
                    >
                      <span
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 ${user.role === 'admin' ? 'bg-primary-600' : 'bg-gray-600 dark:bg-gray-700'}`}
                      >
                        {user.name.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-sm text-gray-900 dark:text-white truncate">{user.name}</span>
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                          {user.lastLogin ? `آخر دخول: ${formatDate(user.lastLogin, true)}` : 'لم يدخل بعد'}
                        </span>
                      </span>
                      <Badge variant={user.role === 'admin' ? 'destructive' : 'secondary'} className="text-[10px] flex-shrink-0">
                        {user.role === 'admin' && <Shield className="w-3 h-3 ml-1" />}
                        {roleLabel(user.role)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-4">
                {users.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={backToUsers} aria-label="تغيير المستخدم" title="تغيير المستخدم">
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                )}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 ${selected.role === 'admin' ? 'bg-primary-600' : 'bg-gray-600 dark:bg-gray-700'}`}
                >
                  {selected.name.charAt(0) || <UserRound className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-900 dark:text-white truncate">{selected.name}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{roleLabel(selected.role)}</p>
                </div>
              </div>

              {selected.hasPin ? (
                <>
                  <div
                    className={`flex items-center justify-center gap-2.5 h-12 mb-2 ${shake ? 'motion-safe:animate-pin-shake' : ''}`}
                    role="status"
                    aria-live="polite"
                    aria-label={pin.length ? `تم إدخال ${pin.length} أرقام` : 'أدخل رمز الدخول'}
                  >
                    {Array.from({ length: Math.max(MIN_PIN_LENGTH, pin.length) }).map((_, index) => (
                      <span
                        key={index}
                        className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${index < pin.length ? 'bg-primary-600 border-primary-600' : 'border-gray-300 dark:border-gray-600'}`}
                      />
                    ))}
                  </div>
                  <p className={`text-center text-xs min-h-[1.25rem] ${error ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`} role={error ? 'alert' : undefined}>
                    {locked ? `أعد المحاولة بعد ${lockSeconds} ثانية` : error ?? 'أدخل رمز الدخول ثم اضغط دخول'}
                  </p>
                  <div className="grid grid-cols-3 gap-2 mt-4" dir="ltr">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                      <PadButton key={digit} label={digit} onPress={() => pressDigit(digit)} disabled={locked || busy} />
                    ))}
                    <PadButton label={<Delete className="w-5 h-5" />} ariaLabel="مسح آخر رقم" onPress={pressBackspace} disabled={busy || pin.length === 0} subtle />
                    <PadButton label="0" onPress={() => pressDigit('0')} disabled={locked || busy} />
                    <PadButton
                      label={busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5 -scale-x-100" />}
                      ariaLabel="دخول"
                      onPress={() => void submit()}
                      disabled={locked || busy || pin.length < MIN_PIN_LENGTH}
                      primary
                    />
                  </div>
                  <div className="text-center mt-4">
                    <button
                      type="button"
                      onClick={() => setRecoveryOpen(true)}
                      className="text-xs text-primary-700 dark:text-primary-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      نسيت رمز الدخول؟
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-center text-xs text-gray-500 dark:text-gray-400">هذا الحساب لا يستخدم رمز دخول. يمكن للمدير تفعيل الحماية أو تعطيلها من الإعدادات.</p>
                  <Button className="w-full" onClick={() => void submit()} disabled={busy || locked}>
                    {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <LogIn className="w-4 h-4 ml-2 -scale-x-100" />}
                    دخول
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {recoveryOpen && selected && (
        <RecoveryDialog user={selected} admins={(users ?? []).filter((user) => user.role === 'admin')} onClose={() => setRecoveryOpen(false)} />
      )}
    </div>
  );
}

function PadButton({
  label,
  ariaLabel,
  onPress,
  disabled,
  primary,
  subtle
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      className={`h-14 rounded-xl text-xl font-bold flex items-center justify-center select-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
        primary
          ? 'bg-primary-600 text-white hover:bg-primary-700'
          : subtle
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
}
