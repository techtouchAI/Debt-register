import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Building, Image, Moon, Sun, Save, Upload, Trash2, User, Shield, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, updateSettings, logActivity } from '@/lib/db';
import { fileToBase64, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { hashPin, isHashedPin, isValidPin, maskPin } from '@/lib/security';
import { OfficeSettings, User as UserType } from '@/types';
import { useLiveQuery } from 'dexie-react-hooks';

export function Settings() {
  const [formData, setFormData] = useState<Partial<OfficeSettings>>({});
  const [isDark, setIsDark] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [userForm, setUserForm] = useState({ name: '', pin: '', role: 'sales' as 'admin' | 'sales' });

  const users = useLiveQuery(() => db.users.toArray(), []);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        if (s) setFormData(s);
      } catch (error) {
        if (!cancelled) reportError('Settings.load', error, 'تعذّر تحميل الإعدادات');
      }
    };

    void loadSettings();
    try {
      const savedTheme = localStorage.getItem('theme');
      setIsDark(savedTheme === 'dark' || document.documentElement.classList.contains('dark'));
    } catch {
      /* التخزين المحلي غير متاح */
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (isSaving) return;
    if (!formData.officeName?.trim()) {
      toast.warning('اسم المكتب مطلوب', 'أدخل اسم المكتب قبل الحفظ');
      return;
    }

    setIsSaving(true);
    try {
      await updateSettings({
        ...formData,
        officeName: formData.officeName.trim(),
        phone: (formData.phone ?? '').trim(),
        address: (formData.address ?? '').trim(),
        lowStockThreshold: Math.max(0, toFiniteNumber(formData.lowStockThreshold, 5)),
        autoBackupInterval: Math.max(5, toFiniteNumber(formData.autoBackupInterval, 60))
      });
      await logActivity('تعديل الإعدادات', 'تم تحديث إعدادات المكتب');
      const s = await getSettings();
      if (s) setFormData(s);
      toast.success('تم حفظ الإعدادات');
    } catch (error) {
      reportError('Settings.save', error, 'تعذّر حفظ الإعدادات');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('ملف غير مدعوم', 'اختر صورة PNG أو JPG');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.warning('حجم الشعار كبير', 'يجب أن يكون أقل من 2 ميجابايت');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setFormData({ ...formData, logo: base64 });
    } catch (error) {
      reportError('Settings.logo', error, 'تعذّر قراءة الصورة');
    }
  };

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    if (newTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setFormData({ ...formData, theme: 'dark' });
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setFormData({ ...formData, theme: 'light' });
    }
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
              <CardTitle className="flex items-center gap-2 text-base"><Building className="w-5 h-5" />بيانات المكتب الزراعي</CardTitle>
              <p className="text-xs text-gray-500">هذه البيانات ستظهر في ترويسة كل فاتورة ووصل</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">اسم المكتب الزراعي *</label>
                    <Input placeholder="مثلاً: مكتب الرافدين الزراعي" value={formData.officeName || ''} onChange={(e) => setFormData({ ...formData, officeName: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">رقم الهاتف</label>
                      <Input placeholder="07xxxxxxxx" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">العملة</label>
                      <select value={formData.currency || 'د.ع'} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                        <option value="د.ع">دينار عراقي (د.ع)</option>
                        <option value="$">$ دولار أمريكي</option>
                        <option value="ر.س">ريال سعودي</option>
                        <option value="ج.م">جنيه مصري</option>
                        <option value="د.أ">دينار أردني</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">العنوان</label>
                    <Input placeholder="المحافظة - المنطقة - الشارع" value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">تذييل الفاتورة</label>
                    <Input placeholder="شكراً لتعاملكم معنا..." value={formData.invoiceFooter || ''} onChange={(e) => setFormData({ ...formData, invoiceFooter: e.target.value })} />
                  </div>
                </div>

                <div className="md:w-48">
                  <label className="text-sm font-medium mb-2 block flex items-center gap-1"><Image className="w-4 h-4" />شعار المكتب</label>
                  <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                    {formData.logo ? (
                      <div className="space-y-3">
                        <img src={formData.logo} alt="Logo" className="w-24 h-24 mx-auto rounded-xl object-cover border" />
                        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setFormData({ ...formData, logo: undefined })}><Trash2 className="w-3 h-3 ml-1" />حذف الشعار</Button>
                      </div>
                    ) : (
                      <div className="py-6">
                        <Image className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-xs text-gray-500 mb-3">ارفع شعار المكتب</p>
                        <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs cursor-pointer hover:bg-primary-700">
                          <Upload className="w-3 h-3" />اختيار ملف
                          <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                        </label>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2">يظهر في الفواتير - أقل من 2MB</p>
                </div>
              </div>
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
                <Input type="number" min="1" value={formData.lowStockThreshold || 5} onChange={(e) => setFormData({ ...formData, lowStockThreshold: Number(e.target.value) })} />
                <p className="text-[11px] text-gray-500 mt-1">عند وصول الكمية لهذا الحد يظهر تنبيه نفاد</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">النسخ الاحتياطي التلقائي</label>
                <div className="flex gap-2">
                  <select value={formData.autoBackupEnabled ? 'yes' : 'no'} onChange={(e) => setFormData({ ...formData, autoBackupEnabled: e.target.value === 'yes' })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                    <option value="yes">مفعل</option>
                    <option value="no">معطل</option>
                  </select>
                  <select value={formData.autoBackupInterval || 60} onChange={(e) => setFormData({ ...formData, autoBackupInterval: Number(e.target.value) })} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
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
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold ${user.role === 'admin' ? 'bg-red-600' : 'bg-blue-600'}`}>
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">{user.name} {user.role === 'admin' ? <Badge variant="destructive" className="text-[10px]"><Shield className="w-3 h-3 ml-1" />مدير</Badge> : <Badge variant="secondary" className="text-[10px]">مبيعات</Badge>}</p>
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

          <Button onClick={handleSave} disabled={isSaving} className="w-full bg-primary-600 hover:bg-primary-700 h-12 font-bold text-base">
            <Save className="w-5 h-5 ml-2" />
            {isSaving ? 'جاري الحفظ…' : 'حفظ جميع الإعدادات'}
          </Button>
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
