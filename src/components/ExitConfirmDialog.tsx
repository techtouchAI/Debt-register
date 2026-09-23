import { useState } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModalCloser } from '@/hooks/useModalCloser';
import { exitApplication } from '@/lib/appExit';

/**
 * حوار تأكيد الخروج النهائي من التطبيق.
 *
 * لا يخرج التطبيق أبداً بضغطة رجوع واحدة: عند الضغط على زر الرجوع في
 * الصفحة الرئيسية (وبلا سجل يُرجع إليه) يظهر هذا الحوار، والمستخدم وحده
 * من يقرر الإغلاق. الحوار نفسه طبقة في مكدس النوافذ، فزر الرجوع أو
 * Escape أثناء فتحه يُغلقانه هو أولاً — لا يخرجان من التطبيق.
 */

interface ExitConfirmDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExitConfirmDialog({ open, onClose }: ExitConfirmDialogProps) {
  const [isExiting, setIsExiting] = useState(false);

  // الرجوع و Escape يُغلقان الحوار وحده (المستمع مركزي في modalStack)
  useModalCloser(open, onClose, { label: 'تأكيد الخروج' });

  if (!open) return null;

  const handleConfirm = async () => {
    if (isExiting) return;
    setIsExiting(true);
    const exited = await exitApplication();
    // إن تعذّر الخروج برمجياً (متصفح عادي) نعود بالحوار بدل تركه عالقاً
    if (!exited) {
      setIsExiting(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="تأكيد الخروج من التطبيق"
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 text-center animate-slide-up">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
          <LogOut className="w-7 h-7 text-red-600 dark:text-red-400" />
        </div>

        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">الخروج من التطبيق؟</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
          هل تريد إغلاق التطبيق نهائياً؟ جميع بياناتك محفوظة تلقائياً ولن تفقد شيئاً.
        </p>

        <div className="flex gap-2">
          <Button variant="destructive" className="flex-1" onClick={handleConfirm} disabled={isExiting}>
            {isExiting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <LogOut className="w-4 h-4 ml-2" />}
            {isExiting ? 'جاري الإغلاق…' : 'إغلاق التطبيق'}
          </Button>
          {/* التركيز المبدئي على الإجراء الآمن (عدم الخروج) — ممارسة قياسية لحوارات التأكيد */}
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isExiting} autoFocus>
            متابعة الاستخدام
          </Button>
        </div>
      </div>
    </div>
  );
}
