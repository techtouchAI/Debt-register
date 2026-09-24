import { useId } from 'react';
import { FileText, Info, ShoppingCart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModalCloser } from '@/hooks/useModalCloser';

/**
 * توضيح الفرق بين «فاتورة بيع جديدة» و«وصل شراء جديد».
 *
 * المشكلة: الزرّان متجاوران في لوحة التحكم وبأيقونتين متشابهتين، فالسؤال
 * «ما الفرق بينهما؟» متوقع من مستخدم جديد — خصوصاً أن كليهما «فاتورة» في
 * الاستعمال الشائع. هذا الحوار يجيب بجملة عملية واحدة لكل جهة: اتجاه حركة
 * المواد، واتجاه المال، وأثر الدين، وشكل رقم المستند.
 *
 * الحوار للقراءة فقط (لا يعدّل بيانات)، ويُغلق بزر الرجوع و Escape مثل بقية
 * طبقات التطبيق عبر `useModalCloser`.
 */

interface SalesVsPurchaseHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const SALE_POINTS = [
  'الزبون يشتري منك، والمواد تخرج من المخزن فتنقص كميتها.',
  'تُسجَّل مبيعات لك: نقداً فوراً أو ديناً على الزبون.',
  'الدين يظهر باسم الزبون في كشف حسابه وفي تقارير الديون.',
  'رقمها يبدأ بالحرف «ف»، ولها دفع مقدم اختياري.'
];

const PURCHASE_POINTS = [
  'أنت تشتري من المورد، والمواد تدخل المخزن فتزيد كميتها.',
  'تُسجَّل مشتريات عليك: نقداً أو ديناً للمورد.',
  'الدين يبقى للمورد ولا يدخل في ديون الزبائن.',
  'رقمه يبدأ بالحرف «ش»، ويُحدَّث المخزن بها فوراً.'
];

export function SalesVsPurchaseHelpDialog({ open, onClose }: SalesVsPurchaseHelpDialogProps) {
  const titleId = useId();
  useModalCloser(open, onClose, { label: 'الفرق بين فاتورة البيع ووصل الشراء' });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl animate-slide-up dark:border-gray-700 dark:bg-gray-800 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
              <Info className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-bold leading-relaxed text-gray-900 dark:text-white">
                ما الفرق بين فاتورة البيع ووصل الشراء؟
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                القاعدة الحاسمة هي اتجاه البضاعة: خارج من المخزن أم داخل إليه.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="إغلاق">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 dark:border-primary-800/40 dark:bg-primary-900/10">
            <h3 className="flex items-center gap-2 font-bold text-primary-700 dark:text-primary-300">
              <FileText className="h-4 w-4 shrink-0" />
              فاتورة بيع جديدة
            </h3>
            <p className="mt-1 text-xs font-medium text-primary-700/80 dark:text-primary-300/80">مبيعات — بضاعة تخرج من المخزن</p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              {SALE_POINTS.map((point) => (
                <li key={point} className="flex gap-2">
                  <span aria-hidden="true" className="shrink-0 text-primary-600 dark:text-primary-400">•</span>
                  <span className="min-w-0 break-words">{point}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-800/40 dark:bg-amber-900/10">
            <h3 className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
              <ShoppingCart className="h-4 w-4 shrink-0" />
              وصل شراء جديد
            </h3>
            <p className="mt-1 text-xs font-medium text-amber-700/80 dark:text-amber-300/80">مشتريات — بضاعة تدخل إلى المخزن</p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              {PURCHASE_POINTS.map((point) => (
                <li key={point} className="flex gap-2">
                  <span aria-hidden="true" className="shrink-0 text-amber-600 dark:text-amber-400">•</span>
                  <span className="min-w-0 break-words">{point}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
          <p className="font-bold text-gray-900 dark:text-white">باختصار:</p>
          <p className="mt-1">
            إن كان المال قادماً إليك مقابل بضاعة تخرج من مخزنك فهي <strong>فاتورة بيع</strong>، وإن كان المال خارجاً منك مقابل بضاعة
            تدخل مخزنك فهو <strong>وصل شراء</strong>. لا تُستخدم فاتورة البيع لشراء المواد، ولا يُستخدم وصل الشراء لبيعها.
          </p>
        </div>

        <div className="mt-5 flex justify-start">
          <Button variant="outline" onClick={onClose}>فهمت، إغلاق</Button>
        </div>
      </div>
    </div>
  );
}
