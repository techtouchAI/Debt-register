import { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Building, Moon, Sun, Save, Loader2, User, Shield, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericTextInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, updateSettings, logActivity } from '@/lib/db';
import { toFiniteNumber } from '@/lib/utils';
import {
  firstInvalidField,
  profileFromSettings,
  validateOfficeProfile,
  type OfficeProfile,
  type OfficeProfileErrors
} from '@/lib/officeProfile';
import { clearFormDraft, loadFormDraft, saveFormDraft } from '@/lib/formDraft';
import { OfficeProfileFields, type OfficeProfileFieldsHandle } from '@/components/setup/OfficeProfileFields';
import { useAsyncScope } from '@/hooks/useAsyncScope';
import { useTheme } from '@/hooks/useTheme';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { hashPin, isHashedPin, isValidPin, maskPin } from '@/lib/security';
import { OfficeSettings, User as UserType } from '@/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { useModalCloser } from '@/hooks/useModalCloser';

/** تفضيلات المخزن والنسخ — الأرقام تُحفظ نصاً أثناء التحرير (انظر أدناه). */
interface SystemPrefs {
  lowStockThreshold: string;
  autoBackupEnabled: boolean;
  autoBackupInterval: string;
}

interface SettingsDraft {
  profile: Omit<OfficeProfile, 'logo'>;
  prefs: SystemPrefs;
}

const SETTINGS_DRAFT_KEY = 'settings-office';

function prefsFromSettings(settings: Partial<OfficeSettings> | null | undefined): SystemPrefs {
  return {
    lowStockThreshold: String(settings?.lowStockThreshold ?? 5),
    autoBackupEnabled: settings?.autoBackupEnabled ?? true,
    autoBackupInterval: String(settings?.autoBackupInterval || 60)
  };
}

export function Settings() {
  /*
   * حالة النموذج:
   *   - `profile` بيانات الترويسة (قواعدها في lib/officeProfile.ts).
   *   - `prefs` تفضيلات المخزن والنسخ. حقل الرقم يُحفظ **نصاً** أثناء الكتابة:
   *     التحويل الفوري بـ Number('') كان يجعل مسح الرقم يكتب 0 في الحقل فلا
   *     يمكن تفريغه وإعادة كتابته (النص "يقفز" تحت أصابع المستخدم).
   *   - `revisionRef` يزيد مع كل تعديل: الحفظ يلتقط الرقم قبل الكتابة، وبعد
   *     انتهائها لا يلمس النموذج إن كتب المستخدم شيئاً خلال الحفظ. سابقاً كانت
   *     القيمة المحفوظة تُكتب فوق الحقول فتُحذف الأحرف المكتوبة أثناء الحفظ.
   */
  const [profile, setProfile] = useState<OfficeProfile>(() => profileFromSettings(null));
  const [prefs, setPrefs] = useState<SystemPrefs>(() => prefsFromSettings(null));
  const [errors, setErrors] = useState<OfficeProfileErrors>({});
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  // السمة من المخزن المشترك (نفس ما يعرضه التخطيط) — لا حالة مكرّرة هنا
  const { isDark, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [userForm, setUserForm] = useState({ name: '', pin: '', role: 'sales' as 'admin' | 'sales' });
  const revisionRef = useRef(0);
  const fieldsRef = useRef<OfficeProfileFieldsHandle>(null);
  const scope = useAsyncScope();

  const users = useLiveQuery(() => db.users.toArray(), []);

  /** تسجيل تعديل من المستخدم (يبطل أي نتيجة حفظ جارية عن الكتابة فوقه). */
  const markEdited = () => {
    revisionRef.current += 1;
    setDirty(true);
  };

  const handleProfileChange = (patch: Partial<OfficeProfile>) => {
    markEdited();
    setProfile((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const keys = Object.keys(patch).filter((key) => key in current);
      if (keys.length === 0) return current;
      const next = { ...current };
      for (const key of keys) delete next[key as keyof OfficeProfileErrors];
      return next;
    });
  };

  const patchPrefs = (patch: Partial<SystemPrefs>) => {
    markEdited();
    setPrefs((current) => ({ ...current, ...patch }));
  };

  // المسودة تُكتب بعد كل تعديل فعلي فقط (لا عند التحميل)، بلا الشعار الكبير.
  useEffect(() => {
    if (!loaded || !dirty) return;
    const { logo: _logo, ...text } = profile;
    saveFormDraft<SettingsDraft>(SETTINGS_DRAFT_KEY, { profile: text, prefs });
  }, [loaded, dirty, profile, prefs]);

  const closeUserForm = () => {
    setShowUserForm(false);
    setEditingUser(null);
  };

  useModalCloser(showUserForm, closeUserForm);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        // لا تستبدل ما يكتبه المستخدم إذا اكتملت الاستجابة بعد بدء التحرير.
        if (revisionRef.current === 0) {
          const draft = loadFormDraft<SettingsDraft>(SETTINGS_DRAFT_KEY);
          const saved = profileFromSettings(s);
          if (draft?.profile && draft.prefs) {
            // مسودة من جلسة سابقة (مغادرة قبل الحفظ / إعادة تشغيل WebView)
            setProfile({ ...saved, ...draft.profile, logo: saved.logo });
            setPrefs({ ...prefsFromSettings(s), ...draft.prefs });
            setDirty(true);
            setRestoredDraft(true);
          } else {
            setProfile(saved);
            setPrefs(prefsFromSettings(s));
          }
        }
      } catch (error) {
        if (!cancelled) reportError('Settings.load', error, 'تعذّر تحميل الإعدادات');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  /** التراجع عن التعديلات غير المحفوظة والعودة للقيم المحفوظة. */
  const discardChanges = async () => {
    try {
      const s = await scope.run(() => getSettings());
      clearFormDraft(SETTINGS_DRAFT_KEY);
      revisionRef.current += 1;
      setProfile(profileFromSettings(s));
      setPrefs(prefsFromSettings(s));
      setErrors({});
      setDirty(false);
      setRestoredDraft(false);
    } catch (error) {
      if (!scope.aborted) reportError('Settings.discard', error, 'تعذّر استعادة القيم المحفوظة');
    }
  };

  const handleSave = async () => {
    if (isSaving) return;

    // نفس قواعد التحقق المستخدمة في معالج التشغيل الأول (lib/officeProfile.ts)
    const validation = validateOfficeProfile(profile);
    if (!validation.ok) {
      setErrors(validation.errors);
      const field = firstInvalidField(validation.errors);
      if (field) fieldsRef.current?.focusField(field);
      toast.warning('بيانات المكتب غير مكتملة', 'صحّح الحقول المعلَّمة باللون الأحمر ثم احفظ');
      return;
    }
    setErrors({});

    const revisionAtStart = revisionRef.current;
    const value = validation.value;
    const nextPrefs = {
      lowStockThreshold: Math.max(0, toFiniteNumber(prefs.lowStockThreshold, 5)),
      autoBackupEnabled: prefs.autoBackupEnabled,
      autoBackupInterval: Math.max(5, toFiniteNumber(prefs.autoBackupInterval, 60))
    };

    setIsSaving(true);
    try {
      await scope.run(async () => {
        // الحقول المحرَّرة فقط — لا نكتب نسخة كاملة قديمة من الإعدادات (كانت
        // تمسح lastBackup الذي يكتبه النسخ التلقائي في الخلفية).
        await updateSettings({ ...value, logo: value.logo, ...nextPrefs, theme: isDark ? 'dark' : 'light' });
        scope.throwIfAborted();
        await logActivity('تعديل الإعدادات', 'تم تحديث إعدادات المكتب').catch((error) =>
          console.warn('تعذّر تسجيل نشاط الإعدادات:', error)
        );
      });
      if (scope.aborted) return;

      if (revisionRef.current === revisionAtStart) {
        // لم يُكتب شيء أثناء الحفظ: نعرض القيم المطبّعة كما حُفظت
        setProfile(value);
        setPrefs({
          lowStockThreshold: String(nextPrefs.lowStockThreshold),
          autoBackupEnabled: nextPrefs.autoBackupEnabled,
          autoBackupInterval: String(nextPrefs.autoBackupInterval)
        });
        setDirty(false);
        clearFormDraft(SETTINGS_DRAFT_KEY);
      }
      // وإلا: المستخدم كتب أثناء الحفظ — نُبقي نصه كما هو ويبقى "غير محفوظ"
      setRestoredDraft(false);
      toast.success('تم حفظ الإعدادات', 'سيظهر الاسم الكامل في الفواتير والتخطيط والنسخ الاحتياطية');
    } catch (error) {
      if (scope.aborted) return;
      reportError('Settings.save', error, 'تعذّر حفظ الإعدادات');
    } finally {
      if (!scope.aborted) setIsSaving(false);
    }
  };

  const toggleTheme = () => {
    // المخزن المشترك يطبّق الصنف على <html> ويحفظه فوراً — السمة تفضيل عرض
    // لا تحتاج زر "حفظ"، وتُكتب في قاعدة البيانات مع الحفظ التالي.
    setTheme(isDark ? 'light' : 'dark');
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = userForm.name.trim();
    if (!name) {
      toast.warning('اسم المستخدم مطلوب');
      return;
    }

    const isEditing = Boolean(editingUser?.id);
    const pinChanged = userForm.pin.trim().length > 0;
    if (!isEditing && !pinChanged) {
      toast.warning('رمز الدخول مطلوب', 'أدخل رمزاً من 4 إلى 8 أرقام');
      return;
    }
    if (pinChanged && !isValidPin(userForm.pin)) {
      toast.warning('رمز دخول غير صالح', 'يجب أن يكون من 4 إلى 8 أرقام فقط');
      return;
    }

    const roleBlocked =
      userForm.role !== 'admin' &&
      editingUser?.role === 'admin' &&
      (users ?? []).filter((user) => user.role === 'admin').length <= 1;
    if (roleBlocked) {
      toast.warning('لا يمكن التغيير', 'يجب بقاء مدير واحد على الأقل في النظام');
      return;
    }

    try {
      const now = new Date().toISOString();
      const hashedPin = pinChanged ? await hashPin(userForm.pin.trim()) : undefined;

      if (editingUser?.id) {
        await db.users.update(editingUser.id, {
          name,
          role: userForm.role,
          ...(hashedPin ? { pin: hashedPin } : {})
        });
        toast.success('تم تحديث المستخدم', name);
      } else {
        await db.users.add({ name, pin: hashedPin ?? '', role: userForm.role, createdAt: now });
        toast.success('تمت إضافة المستخدم', name);
      }

      setShowUserForm(false);
      setEditingUser(null);
      setUserForm({ name: '', pin: '', role: 'sales' });
    } catch (error) {
      reportError('Settings.user.save', error, 'تعذّر حفظ المستخدم');
    }
  };

  const handleDeleteUser = async (user: UserType) => {
    if (!user.id) return;
    if ((users ?? []).length <= 1) {
      toast.warning('لا يمكن الحذف', 'يجب بقاء مستخدم واحد على الأقل');
      return;
    }
    if (user.role === 'admin' && (users ?? []).filter((entry) => entry.role === 'admin').length <= 1) {
      toast.warning('لا يمكن الحذف', 'يجب بقاء مدير واحد على الأقل في النظام');
      return;
    }
    if (!confirm(`هل أنت متأكد من حذف المستخدم "${user.name}"؟`)) return;

    try {
      await db.users.delete(user.id);
      toast.success('تم حذف المستخدم', user.name);
    } catch (error) {
      reportError('Settings.user.delete', error, 'تعذّر حذف المستخدم');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <SettingsIcon className="w-7 h-7 text-primary-600" />
          الإعدادات
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">إعدادات النظام والمكتب والمظهر</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Office Info */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Building className="w-5 h-5" />بيانات المكتب</CardTitle>
              <p className="text-xs text-gray-500">هذه البيانات ستظهر في ترويسة كل فاتورة ووصل</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {restoredDraft && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300" role="status">
                  <span>استُعيدت تعديلات لم تُحفظ من المرة السابقة — راجعها ثم اضغط "حفظ جميع الإعدادات".</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void discardChanges()}>
                    تجاهل التعديلات
                  </Button>
                </div>
              )}
              <OfficeProfileFields
                ref={fieldsRef}
                idPrefix="settings"
                value={profile}
                errors={errors}
                onChange={handleProfileChange}
                disabled={!loaded}
              />
            </CardContent>
          </Card>

          {/* Inventory Settings */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Database className="w-5 h-5" />إعدادات المخزن</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">الحد الأدنى للتنبيه (افتراضي)</label>
                <NumericTextInput value={prefs.lowStockThreshold} onValueChange={(lowStockThreshold) => patchPrefs({ lowStockThreshold })} />
                <p className="text-[11px] text-gray-500 mt-1">عند وصول الكمية لهذا الحد يظهر تنبيه نفاد</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">النسخ الاحتياطي التلقائي</label>
                <div className="flex gap-2">
                  <select value={prefs.autoBackupEnabled ? 'yes' : 'no'} onChange={(e) => patchPrefs({ autoBackupEnabled: e.target.value === 'yes' })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                    <option value="yes">مفعل</option>
                    <option value="no">معطل</option>
                  </select>
                  <select value={prefs.autoBackupInterval} onChange={(e) => patchPrefs({ autoBackupInterval: e.target.value })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                    <option value="30">كل 30 دقيقة</option>
                    <option value="60">كل ساعة</option>
                    <option value="120">كل ساعتين</option>
                    <option value="360">كل 6 ساعات</option>
                    <option value="1440">يومياً</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Users - Offline */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base"><User className="w-5 h-5" />إدارة المستخدمين (بدون انترنت)</CardTitle>
                <Button size="sm" onClick={() => { setEditingUser(null); setUserForm({ name: '', pin: '', role: 'sales' }); setShowUserForm(true); }}>إضافة مستخدم</Button>
              </div>
              <p className="text-xs text-gray-500">نظام محلي - مدير يملك حذف وتعديل، موظف مبيعات فقط للبيع</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {users?.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold ${user.role === 'admin' ? 'bg-primary-600' : 'bg-gray-600 dark:bg-gray-700'}`}>
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">{user.name} {user.role === 'admin' ? <Badge variant="destructive" className="text-[10px]"><Shield className="w-3 h-3 ml-1" />مدير</Badge> : <Badge variant="secondary" className="text-[10px]">مبيعات</Badge>}</div>
                        <p className="text-xs text-gray-500">رمز الدخول: {maskPin()} • منذ {new Date(user.createdAt).toLocaleDateString('ar-EG')}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEditingUser(user); setUserForm({ name: user.name, pin: '', role: user.role }); setShowUserForm(true); }}>تعديل</Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-red-600" onClick={() => handleDeleteUser(user)}>حذف</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Appearance */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Moon className="w-5 h-5" />المظهر</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <div className="flex items-center gap-2">
                  {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  <span className="text-sm font-medium">الوضع الليلي/النهاري</span>
                </div>
                <Button variant="outline" size="sm" onClick={toggleTheme}>{isDark ? 'نهاري' : 'ليلي'}</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={`p-3 rounded-xl border-2 cursor-pointer ${!isDark ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => { if (isDark) toggleTheme(); }}>
                  <div className="w-full h-16 bg-white rounded-lg border shadow-sm mb-2"></div>
                  <p className="text-xs text-center font-medium">نهاري</p>
                </div>
                <div className={`p-3 rounded-xl border-2 cursor-pointer ${isDark ? 'border-primary-600 bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => { if (!isDark) toggleTheme(); }}>
                  <div className="w-full h-16 bg-gray-800 rounded-lg border border-gray-700 shadow-sm mb-2"></div>
                  <p className="text-xs text-center font-medium">ليلي</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base">معلومات النظام</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">الإصدار</span><span className="font-bold">1.0.0</span></div>
              <div className="flex justify-between"><span className="text-gray-500">نوع التطبيق</span><Badge variant="success" className="text-[10px]">بدون انترنت - Offline</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">قاعدة البيانات</span><span>IndexedDB</span></div>
              <div className="flex justify-between"><span className="text-gray-500">المنصات</span><span>Android + Windows 10/11</span></div>
              <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-xl p-3 text-xs text-green-800 dark:text-green-300">
                <p className="font-bold">✓ آمن ومحلي 100%</p>
                <p className="mt-1">جميع البيانات محفوظة على جهازك فقط، لا يتم إرسال أي شيء للانترنت.</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2 lg:sticky lg:top-20">
            <Button onClick={handleSave} disabled={isSaving || !loaded} className="w-full bg-primary-600 hover:bg-primary-700 h-12 font-bold text-base">
              {isSaving ? <Loader2 className="w-5 h-5 ml-2 animate-spin" /> : <Save className="w-5 h-5 ml-2" />}
              {isSaving ? 'جاري الحفظ…' : 'حفظ جميع الإعدادات'}
            </Button>
            <p className="text-center text-[11px] text-gray-500 dark:text-gray-400" aria-live="polite">
              {dirty ? 'لديك تعديلات غير محفوظة (محفوظة كمسودة على هذا الجهاز)' : 'جميع التعديلات محفوظة'}
            </p>
          </div>
        </div>
      </div>

      {showUserForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{editingUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUserSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">اسم المستخدم</label>
                  <Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} placeholder="مثلاً: أحمد، موظف المبيعات" required />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">رمز الدخول PIN (4 إلى 8 أرقام)</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={userForm.pin}
                    onChange={(e) => setUserForm({ ...userForm, pin: e.target.value })}
                    placeholder={editingUser ? 'اتركه فارغاً للإبقاء على الرمز الحالي' : '1234'}
                    required={!editingUser}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    يُحفظ كبصمة مشفّرة داخل الجهاز ولا يظهر لأي شخص.
                    {editingUser && isHashedPin(editingUser.pin) ? '' : editingUser ? ' الرمز الحالي بصيغة قديمة وسيُحدَّث عند تغييره.' : ''}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">الصلاحية</label>
                  <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value === 'admin' ? 'admin' : 'sales' })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                    <option value="sales">موظف مبيعات - بيع فقط</option>
                    <option value="admin">مدير - كامل الصلاحيات</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" className="flex-1 bg-primary-600">{editingUser ? 'حفظ التعديل' : 'إضافة المستخدم'}</Button>
                  <Button type="button" variant="outline" onClick={() => { setShowUserForm(false); setEditingUser(null); }}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
