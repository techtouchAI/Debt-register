import { useRef, useState } from 'react';
import { CheckCircle, Loader2, Store } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getSettings, logActivity, setMeta, updateSettings } from '@/lib/db';
import {
  firstInvalidField,
  profileFromSettings,
  validateOfficeProfile,
  type OfficeProfile,
  type OfficeProfileErrors
} from '@/lib/officeProfile';
import { useAsyncScope } from '@/hooks/useAsyncScope';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { OfficeProfileFields, type OfficeProfileFieldsHandle } from '@/components/setup/OfficeProfileFields';
import type { OfficeSettings } from '@/types';

/**
 * معالج إعداد المكتب في التشغيل الأول.
 *
 * يظهر عند فتح التطبيق أول مرة (أو كلما كانت بيانات الترويسة ناقصة، مثلاً
 * بعد استيراد نسخة قديمة) ويطلب البيانات التي ستظهر في كل فاتورة ووصل.
 * **لا يمكن تجاوزه**: الاسم والهاتف والعملة والعنوان وتذييل الفاتورة إلزامية
 * (الشعار وحده اختياري)، والقواعد نفسها في `lib/officeProfile.ts` هي التي
 * يستخدمها `App` ليقرر عرض المعالج — فلا طريق لتخطيه بحفظ جزئي.
 */

interface FirstRunSetupProps {
  initial?: OfficeSettings | null;
  onDone: (settings: OfficeSettings) => void;
}

export const SETUP_COMPLETED_KEY = 'office-setup-completed';

export function FirstRunSetup({ initial, onDone }: FirstRunSetupProps) {
  // حالة واحدة للنموذج كله: كل تغيير يُطبَّق كتحديث وظيفي على أحدث قيمة،
  // فلا يمكن لتحديث حقل أن يعيد قيمة قديمة لحقل آخر.
  const [profile, setProfile] = useState<OfficeProfile>(() => {
    const base = profileFromSettings(initial);
    // الاسم فارغ عمداً في التثبيت الجديد — لا يُكتب أي اسم تلقائياً؛ أما
    // التذييل فله نص مقترح يمكن تعديله.
    return { ...base, invoiceFooter: base.invoiceFooter || 'شكراً لتعاملكم معنا' };
  });
  const [errors, setErrors] = useState<OfficeProfileErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const fieldsRef = useRef<OfficeProfileFieldsHandle>(null);
  /* النطاق يُلغى عند مغادرة الشاشة فيتوقف الحفظ في منتصفه بدل أن يكتب في
     قاعدة بيانات أُغلقت (سبب أخطاء DatabaseClosedError المتأخرة سابقاً). */
  const scope = useAsyncScope();

  const handleChange = (patch: Partial<OfficeProfile>) => {
    setProfile((current) => ({ ...current, ...patch }));
    // إزالة رسالة الخطأ عن الحقل الذي يُصحَّح الآن فقط
    setErrors((current) => {
      const keys = Object.keys(patch).filter((key) => key in current);
      if (keys.length === 0) return current;
      const next = { ...current };
      for (const key of keys) delete next[key as keyof OfficeProfileErrors];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const validation = validateOfficeProfile(profile);
    if (!validation.ok) {
      setErrors(validation.errors);
      const field = firstInvalidField(validation.errors);
      if (field) fieldsRef.current?.focusField(field);
      toast.warning('أكمل بيانات المكتب', 'جميع الحقول المعلَّمة بـ * إلزامية قبل بدء الاستخدام');
      return;
    }
    const value = validation.value;
    setErrors({});

    setIsSaving(true);
    try {
      await scope.run(async () => {
        await updateSettings(value);
        scope.throwIfAborted();
        await setMeta(SETUP_COMPLETED_KEY, new Date().toISOString());
        scope.throwIfAborted();
        await logActivity('إعداد المكتب', `تم إعداد بيانات المكتب لأول مرة: ${value.officeName}`).catch(
          () => undefined
        );
        scope.throwIfAborted();
      });

      const saved = await scope.runQuiet(() => getSettings());
      if (scope.aborted) return;
      toast.success('تم إعداد المكتب بنجاح', `أهلاً بك في ${value.officeName}`);
      onDone(
        saved || {
          ...value,
          lowStockThreshold: 5,
          theme: 'light',
          autoBackupEnabled: true,
          autoBackupInterval: 60,
          language: 'ar'
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
            <h1 className="text-2xl font-bold mb-2">مرحباً بك في نظام إدارة المكتب</h1>
            <p className="text-white/80 text-sm leading-relaxed max-w-lg mx-auto">
              قبل البدء، أدخل بيانات مكتبك (جميع الحقول المعلَّمة بـ * إلزامية) — ستظهر هذه البيانات في ترويسة كل فاتورة ووصل قبض.
              يمكنك تعديلها لاحقاً من صفحة الإعدادات.
            </p>
          </div>
        </div>

        <CardContent className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <OfficeProfileFields
              ref={fieldsRef}
              idPrefix="setup"
              value={profile}
              errors={errors}
              onChange={handleChange}
              autoFocusName
              disabled={isSaving}
              logoColumnClassName="md:w-44"
            />

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
