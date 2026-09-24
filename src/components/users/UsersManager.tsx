import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Copy, KeyRound, Loader2, Lock, LockOpen, Pencil, Shield, Trash2, User as UserIcon, UserPlus, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useModalCloser } from '@/hooks/useModalCloser';
import { useSession } from '@/hooks/useSession';
import { db } from '@/lib/db';
import {
  DEFAULT_ADMIN_PIN,
  formatRecoveryCode,
  generateRecoveryCode,
  hasRecoveryCode,
  isLoginRequired,
  listLoginUsers,
  loginRequiredFor,
  type LoginUserSummary
} from '@/lib/auth';
import { createUser, deleteUser, updateUser, UserRuleError, UserValidationError, type UserErrors, type UserInput } from '@/lib/users';
import { confirmDialog } from '@/lib/confirm';
import { roleLabel } from '@/lib/labels';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { formatDate } from '@/lib/utils';
import type { Role } from '@/lib/permissions';

/**
 * إدارة المستخدمين (بدون إنترنت) في صفحة الإعدادات.
 *
 * للمستخدمين أثر فعلي في التطبيق:
 *   - عند وجود أكثر من مستخدم (أو تغيير رمز المدير) يُطلب رمز الدخول عند فتح
 *     التطبيق، ويظهر زر "قفل" في الشريط العلوي لتبديل المستخدم.
 *   - موظف المبيعات يبيع فقط: لا يرى المشتريات والتقارير والنسخ والإعدادات،
 *     ولا يعدّل أو يحذف أي سجل.
 *   - كل عملية تُنسب في سجل النشاط إلى من نفّذها.
 */
export function UsersManager() {
  const session = useSession();
  // الحالة تُحسب من جدول المستخدمين مباشرة (تتحدّث بعد كل إضافة/تعديل)
  const users = useLiveQuery(() => listLoginUsers(), []);
  const records = useLiveQuery(() => db.users.toArray(), []);
  const recoveryExists = useLiveQuery(() => hasRecoveryCode(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LoginUserSummary | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const lockEnabled = users ? loginRequiredFor(users) : false;
  const defaultPinAdmins = (users ?? []).filter((user) => user.role === 'admin' && user.hasDefaultPin);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (user: LoginUserSummary) => {
    setEditing(user);
    setFormOpen(true);
  };

  /** بعد أي تغيير: إبلاغ المستخدم إن أصبح قفل الدخول مفعّلاً، واقتراح رمز استرداد. */
  const afterChange = async (wasLocked: boolean) => {
    const nowLocked = await isLoginRequired();
    if (!wasLocked && nowLocked) {
      toast.info('تم تفعيل قفل الدخول', 'سيُطلب رمز الدخول عند فتح التطبيق، ويمكنك تبديل المستخدم من زر القفل في الأعلى');
    }
    if (nowLocked && !(await hasRecoveryCode())) {
      const create = await confirmDialog({
        title: 'إنشاء رمز استرداد الآن؟',
        message:
          'رمز الاسترداد يُعيد لك الدخول إن نسي المدير رمزه (لا يوجد إنترنت لاستعادة الحساب).\nاكتبه على ورقة واحفظه في مكان آمن.',
        confirmText: 'إنشاء رمز استرداد',
        cancelText: 'لاحقاً'
      });
      if (create) await handleGenerateRecovery(false);
    }
  };

  const handleDelete = async (user: LoginUserSummary) => {
    const confirmed = await confirmDialog({
      title: `حذف المستخدم "${user.name}"؟`,
      message: 'لن يتمكن من الدخول بعد الحذف، وتبقى عملياته السابقة في السجلات باسمه.',
      confirmText: 'حذف المستخدم',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await deleteUser(user.id);
      toast.success('تم حذف المستخدم', user.name);
    } catch (error) {
      if (error instanceof UserRuleError) toast.warning('لا يمكن الحذف', error.message);
      else reportError('Users.delete', error, 'تعذّر حذف المستخدم');
    }
  };

  const handleGenerateRecovery = async (askFirst = true) => {
    if (askFirst && recoveryExists) {
      const confirmed = await confirmDialog({
        title: 'إنشاء رمز استرداد جديد؟',
        message: 'سيتوقف الرمز السابق عن العمل فوراً.',
        confirmText: 'إنشاء رمز جديد',
        tone: 'warning'
      });
      if (!confirmed) return;
    }
    try {
      setRecoveryCode(await generateRecoveryCode());
    } catch (error) {
      reportError('Users.recovery', error, 'تعذّر إنشاء رمز الاسترداد');
    }
  };

  const recordFor = (id: number) => records?.find((record) => record.id === id);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserIcon className="w-5 h-5" />
            إدارة المستخدمين (بدون انترنت)
          </CardTitle>
          <Button size="sm" onClick={openAdd}>
            <UserPlus className="w-4 h-4 ml-1" />
            إضافة مستخدم
          </Button>
        </div>
        <p className="text-xs text-gray-500">المدير يملك كل الصلاحيات (إضافة وتعديل وحذف)، وموظف المبيعات للبيع فقط.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${lockEnabled ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/40 dark:bg-green-900/20 dark:text-green-300' : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300'}`}
          role="status"
          data-testid="lock-status"
        >
          {lockEnabled ? <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <LockOpen className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>
            {lockEnabled ? (
              <>
                <strong>قفل الدخول مفعّل:</strong> يُطلب رمز الدخول عند فتح التطبيق، وزر القفل في الشريط العلوي يبدّل المستخدم.
              </>
            ) : (
              <>
                <strong>قفل الدخول غير مفعّل:</strong> يدخل التطبيق مباشرة كمدير. أضف موظفاً أو غيّر رمز المدير لتفعيل الدخول برمز.
              </>
            )}
          </span>
        </div>

        {lockEnabled && defaultPinAdmins.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              رمز {defaultPinAdmins.map((user) => user.name).join('، ')} ما زال الرمز الافتراضي (<span dir="ltr">{DEFAULT_ADMIN_PIN}</span>) — أي شخص
              يستطيع الدخول به. غيّره الآن.
              <div className="mt-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(defaultPinAdmins[0])}>
                  تغيير الرمز
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {(users ?? []).map((user) => {
            const record = recordFor(user.id);
            const isSelf = session?.id === user.id;
            return (
              <div key={user.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50" data-testid="user-row">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 ${user.role === 'admin' ? 'bg-primary-600' : 'bg-gray-600 dark:bg-gray-700'}`}
                  >
                    {user.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      <span className="truncate">{user.name}</span>
                      {isSelf && <span className="text-[10px] text-primary-700 dark:text-primary-400">(أنت)</span>}
                      <Badge variant={user.role === 'admin' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {user.role === 'admin' && <Shield className="w-3 h-3 ml-1" />}
                        {roleLabel(user.role)}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {user.lastLogin ? `آخر دخول: ${formatDate(user.lastLogin, true)}` : 'لم يدخل بعد'}
                      {record?.createdAt ? ` • أُضيف ${formatDate(record.createdAt)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openEdit(user)} aria-label={`تعديل ${user.name}`}>
                    <Pencil className="w-3.5 h-3.5 ml-1" />
                    تعديل
                  </Button>
                  {!isSelf && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-red-600" onClick={() => void handleDelete(user)} aria-label={`حذف ${user.name}`}>
                      <Trash2 className="w-3.5 h-3.5 ml-1" />
                      حذف
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="w-4 h-4 text-primary-600" />
              رمز الاسترداد
              <Badge variant={recoveryExists ? 'success' : 'warning'} className="text-[10px]">
                {recoveryExists ? 'محفوظ' : 'غير موجود'}
              </Badge>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void handleGenerateRecovery()}>
              {recoveryExists ? 'إنشاء رمز جديد' : 'إنشاء رمز استرداد'}
            </Button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            يُستخدم من شاشة الدخول ("نسيت رمز الدخول؟") ليعيّن المدير رمزاً جديداً إن نسي رمزه. يُعرض مرة واحدة فقط عند إنشائه.
          </p>
        </div>
      </CardContent>

      {formOpen && (
        <UserFormDialog
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(wasLocked) => {
            setFormOpen(false);
            void afterChange(wasLocked);
          }}
        />
      )}
      {recoveryCode && <RecoveryCodeDialog code={recoveryCode} onClose={() => setRecoveryCode(null)} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * نموذج إضافة/تعديل مستخدم
 * ------------------------------------------------------------------ */

function UserFormDialog({
  editing,
  onClose,
  onSaved
}: {
  editing: LoginUserSummary | null;
  onClose: () => void;
  onSaved: (wasLocked: boolean) => void;
}) {
  const formId = useId();
  const [form, setForm] = useState<UserInput>({
    name: editing?.name ?? '',
    role: editing?.role ?? 'sales',
    pin: '',
    confirmPin: ''
  });
  const [errors, setErrors] = useState<UserErrors>({});
  const [saving, setSaving] = useState(false);

  useModalCloser(true, onClose, { label: editing ? 'تعديل مستخدم' : 'إضافة مستخدم' });

  const patch = (next: Partial<UserInput>) => {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const copy = { ...current };
      for (const key of Object.keys(next)) delete copy[key as keyof UserErrors];
      return copy;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const wasLocked = await isLoginRequired();
      if (editing) {
        await updateUser(editing.id, form);
        toast.success('تم تحديث المستخدم', form.name.trim());
      } else {
        await createUser(form);
        toast.success('تمت إضافة المستخدم', `${form.name.trim()} — ${roleLabel(form.role)}`);
      }
      onSaved(wasLocked);
    } catch (error) {
      if (error instanceof UserValidationError) {
        setErrors(error.errors);
        const first = (['name', 'role', 'pin', 'confirmPin'] as const).find((field) => error.errors[field]);
        if (first) document.getElementById(`${formId}-${first}`)?.focus();
      } else if (error instanceof UserRuleError) {
        toast.warning('لا يمكن الحفظ', error.message);
      } else {
        reportError('Users.save', error, 'تعذّر حفظ المستخدم');
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (name: keyof UserErrors) => ({
    id: `${formId}-${name}`,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${formId}-${name}-error` : undefined
  });

  const errorText = (name: keyof UserErrors) =>
    errors[name] ? (
      <p id={`${formId}-${name}-error`} className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium" role="alert">
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <Card className="w-full max-w-md max-h-[92vh] overflow-y-auto overscroll-contain animate-slide-up" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle id={`${formId}-title`}>{editing ? `تعديل المستخدم: ${editing.name}` : 'إضافة مستخدم جديد'}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* noValidate: التحقق عربي بالكامل هنا — فقاعات المتصفح الأصلية قد تظهر
              بالإنجليزية (ويندوز) أو لا تظهر أصلاً (أندرويد) فيبدو الزر معطلاً */}
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block" htmlFor={`${formId}-name`}>
                اسم المستخدم
              </label>
              <Input {...field('name')} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="مثلاً: أحمد" autoFocus autoComplete="off" />
              {errorText('name')}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block" htmlFor={`${formId}-role`}>
                الصلاحية
              </label>
              <select
                {...field('role')}
                value={form.role}
                onChange={(e) => patch({ role: (e.target.value === 'admin' ? 'admin' : 'sales') as Role })}
                className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              >
                <option value="sales">موظف مبيعات — بيع فقط</option>
                <option value="admin">مدير — كامل الصلاحيات</option>
              </select>
              {errorText('role')}
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                {form.role === 'sales'
                  ? 'يبيع ويطبع الفواتير، يستلم التسديدات، يضيف زبوناً جديداً، ويطّلع على المخزن والزبائن — دون تعديل أو حذف.'
                  : 'كل الصلاحيات: المخزن والمشتريات والتقارير والنسخ الاحتياطي والإعدادات والمستخدمون.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block" htmlFor={`${formId}-pin`}>
                  رمز الدخول
                </label>
                <Input
                  {...field('pin')}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={form.pin}
                  onChange={(e) => patch({ pin: e.target.value })}
                  placeholder={editing ? 'بلا تغيير' : '4 إلى 8 أرقام'}
                />
                {errorText('pin')}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block" htmlFor={`${formId}-confirmPin`}>
                  تأكيد الرمز
                </label>
                <Input
                  {...field('confirmPin')}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={form.confirmPin}
                  onChange={(e) => patch({ confirmPin: e.target.value })}
                  placeholder="أعد كتابة الرمز"
                />
                {errorText('confirmPin')}
              </div>
            </div>
            <p className="text-[11px] text-gray-500 -mt-2">
              {editing ? 'اترك الرمز فارغاً للإبقاء على الرمز الحالي. ' : ''}يُحفظ الرمز كبصمة مشفّرة داخل الجهاز ولا يظهر لأي شخص.
            </p>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
                {editing ? 'حفظ التعديل' : 'إضافة المستخدم'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                إلغاء
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * عرض رمز الاسترداد (مرة واحدة)
 * ------------------------------------------------------------------ */

function RecoveryCodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const formatted = formatRecoveryCode(code);

  useModalCloser(true, onClose, { label: 'رمز الاسترداد' });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      toast.info('انسخ الرمز يدوياً', 'تعذّر الوصول إلى الحافظة على هذا الجهاز');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div role="dialog" aria-modal="true" aria-label="رمز الاسترداد" className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 text-center animate-slide-up">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
          <KeyRound className="w-6 h-6 text-primary-600" />
        </div>
        <h2 className="font-bold text-gray-900 dark:text-white mb-2">رمز الاسترداد</h2>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
          اكتب هذا الرمز على ورقة واحفظه في مكان آمن. لن يظهر مرة أخرى، ويُستخدم مرة واحدة لاستعادة دخول المدير.
        </p>
        <p className="text-2xl font-bold tracking-widest text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-900 rounded-xl py-3 select-all" dir="ltr" data-testid="recovery-code">
          {formatted}
        </p>
        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={() => void copy()}>
            <Copy className="w-4 h-4 ml-1" />
            {copied ? 'تم النسخ' : 'نسخ'}
          </Button>
          <Button className="flex-1" onClick={onClose}>
            حفظته
          </Button>
        </div>
      </div>
    </div>
  );
}
