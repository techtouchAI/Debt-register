import { useState } from 'react';
import { Building, Upload, Trash2, CheckCircle, Loader2, Store } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSettings, logActivity, setMeta, updateSettings } from '@/lib/db';
import { fileToBase64 } from '@/lib/utils';
import { MAX_OFFICE_NAME_LENGTH, validateOfficeName } from '@/lib/officeName';
import { useAsyncScope } from '@/hooks/useAsyncScope';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import type { OfficeSettings } from '@/types';

/**
 * معالج إعداد المكتب في التشغيل الأول.
 *
 * يظهر مرة واحدة عند فتح التطبيق أول مرة (أو بعد استيراد نسخة بلا اسم
 * مكتب) ويطلب بيانات الترويسة التي ستظهر في كل فاتورة ووصل. لا يمكن
 * تجاوزه، وحقل الاسم فارغ عمداً — لا يُكتب أي اسم تلقائياً.
 */

interface FirstRunSetupProps {
  initial?: OfficeSettings | null;
  onDone: (settings: OfficeSettings) => void;
}

export const SETUP_COMPLETED_KEY = 'office-setup-completed';

export function FirstRunSetup({ initial, onDone }: FirstRunSetupProps) {
  const [officeName, setOfficeName] = useState(initial?.officeName || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [currency, setCurrency] = useState(initial?.currency || 'د.ع');
  const [invoiceFooter, setInvoiceFooter] = useState(initial?.invoiceFooter || 'شكراً لتعاملكم معنا');
  const [logo, setLogo] = useState<string | undefined>(initial?.logo);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  /* النطاق يُلغى عند مغادرة الشاشة فيتوقف الحفظ في منتصفه بدل أن يكتب في
     قاعدة بيانات أُغلقت (سبب أخطاء DatabaseClosedError المتأخرة سابقاً). */
  const scope = useAsyncScope();

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
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
      setLogo(await fileToBase64(file));
    } catch (error) {
      reportError('FirstRunSetup.logo', error, 'تعذّر قراءة الصورة');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    // التحقق نفسه المستخدم في الإعدادات: الاسم الكامل يُقبل (حتى الطويل)،
    // ويرفض فقط الفراغ أو تجاوز الحد الأقصى مع رسالة واضحة.
    const validation = validateOfficeName(officeName);
    if (!validation.ok) {
      setNameError(validation.error ?? 'اسم المكتب مطلوب');
      toast.warning('اسم المكتب غير صالح', validation.error ?? 'أدخل اسم مكتبك الحقيقي');
      return;
    }
    const trimmedName = validation.value;
    setNameError(null);

    setIsSaving(true);
    try {
      // runQuiet: عند مغادرة الشاشة يتوقف التسلسل هنا بدل المتابعة على قاعدة مغلقة
      await scope.run(async () => {
        await updateSettings({
          officeName: trimmedName,
          phone: phone.trim(),
          address: address.trim(),
          currency,
          invoiceFooter: invoiceFooter.trim(),
          logo
        });
        scope.throwIfAborted();
        await setMeta(SETUP_COMPLETED_KEY, new Date().toISOString());
        scope.throwIfAborted();
        await logActivity('إعداد المكتب', `تم إعداد بيانات المكتب لأول مرة: ${trimmedName}`).catch(
          () => undefined
        );
        scope.throwIfAborted();
      });

      const saved = await scope.runQuiet(() => getSettings());
      if (scope.aborted) return;
      toast.success('تم إعداد المكتب بنجاح', `أهلاً بك في ${trimmedName}`);
      onDone(
        saved || {
          officeName: trimmedName,
          phone: phone.trim(),
          address: address.trim(),
          currency,
          lowStockThreshold: 5,
          theme: 'light',
          autoBackupEnabled: true,
          autoBackupInterval: 60,
          language: 'ar',
          invoiceFooter: invoiceFooter.trim(),
          logo
        }
      );
    } catch (error) {
      if (scope.aborted) return; // الشاشة غادرت: لا رسائل ولا تحديث حالة
      reportError('FirstRunSetup.save', error, 'تعذّر حفظ بيانات المكتب');
    } finally {
      if (!scope.aborted) setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 font-cairo" dir="rtl">
      <Card className="w-full max-w-2xl border-0 shadow-2xl overflow-hidden animate-slide-up">
        <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 dark:from-black dark:to-gray-900 p-6 sm:p-8 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative z-10">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mx-auto mb-4">
              <Store className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold mb-2">مرحباً بك في نظام إدارة المكتب الزراعي 🌾</h1>
            <p className="text-white/80 text-sm leading-relaxed max-w-lg mx-auto">
              قبل البدء، أدخل بيانات مكتبك — ستظهر هذه البيانات في ترويسة كل فاتورة ووصل قبض.
              يمكنك تعديلها لاحقاً من صفحة الإعدادات.
            </p>
          </div>
        </div>

        <CardContent className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col md:flex-row gap-5">
              <div className="flex-1 space-y-4">
                <div>
                  <label className="text-sm font-bold mb-1.5 flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-primary-600" />
                    اسم المكتب الزراعي *
                  </label>
                  <Input
                    value={officeName}
                    onChange={(e) => {
                      setOfficeName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder="اكتب اسم مكتبك هنا — مثلاً: مكتب الرافدين الزراعي"
                    className={`h-12 text-base ${nameError ? 'border-red-400 focus:ring-red-400' : ''}`}
                    autoFocus
                    required
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby="office-name-help"
                    maxLength={MAX_OFFICE_NAME_LENGTH}
                  />
                  <div id="office-name-help" className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    {nameError ? (
                      <span className="text-red-600 dark:text-red-400 font-medium">{nameError}</span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        يُحفظ الاسم كاملاً ويظهر في كل فاتورة ووصل وفي اسم ملف النسخة الاحتياطية
                      </span>
                    )}
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                      {officeName.length}/{MAX_OFFICE_NAME_LENGTH}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">رقم الهاتف</label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" dir="ltr" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">العملة</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    >
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
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="المحافظة - المنطقة - الشارع" />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">تذييل الفاتورة</label>
                  <Input value={invoiceFooter} onChange={(e) => setInvoiceFooter(e.target.value)} placeholder="شكراً لتعاملكم معنا..." />
                </div>
              </div>

              <div className="md:w-44 flex-shrink-0">
                <label className="text-sm font-medium mb-2 block">شعار المكتب (اختياري)</label>
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                  {logo ? (
                    <div className="space-y-3">
                      <img src={logo} alt="شعار المكتب" className="w-24 h-24 mx-auto rounded-xl object-cover border" />
                      <Button variant="outline" size="sm" type="button" className="w-full text-xs" onClick={() => setLogo(undefined)}>
                        <Trash2 className="w-3 h-3 ml-1" />
                        حذف الشعار
                      </Button>
                    </div>
                  ) : (
                    <div className="py-6">
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-xs text-gray-500 mb-3">يظهر في الفواتير</p>
                      <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs cursor-pointer hover:bg-primary-700">
                        <Upload className="w-3 h-3" />
                        اختيار ملف
                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-xl p-3 text-xs text-green-800 dark:text-green-300 flex gap-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>جميع بياناتك محفوظة على جهازك فقط وتعمل بدون انترنت — لا يُرسل أي شيء للخارج.</p>
            </div>

            <Button type="submit" disabled={isSaving} className="w-full h-12 text-base font-bold bg-primary-600 hover:bg-primary-700">
              {isSaving && <Loader2 className="w-5 h-5 ml-2 animate-spin" />}
              {isSaving ? 'جاري الحفظ…' : 'حفظ وبدء استخدام النظام'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
