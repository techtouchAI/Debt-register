import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModalCloser } from '@/hooks/useModalCloser';
import { cancelAllConfirms, getActiveConfirm, settleConfirm, subscribeConfirm, type ConfirmRequest } from '@/lib/confirm';
import { cn } from '@/lib/utils';

/**
 * مكوّن عرض حوارات التأكيد (يُركّب مرة واحدة في جذر التطبيق).
 * انظر `lib/confirm.ts` لسبب الاستغناء عن حوارات المتصفح الأصلية.
 */
export function ConfirmDialogHost() {
  const active = useSyncExternalStore(subscribeConfirm, getActiveConfirm, getActiveConfirm);

  // إلغاء تركيب المضيف (الانتقال بين شاشة الدخول والتطبيق) يُلغي أي طلب
  // معلّق بدل تركه ينتظر للأبد.
  useEffect(() => () => cancelAllConfirms(), []);

  if (!active) return null;
  // مفتاح لكل طلب: حالة الحقل (النص المطلوب) تبدأ فارغة مع كل حوار جديد
  return <ConfirmDialogView key={active.id} request={active} />;
}

function ConfirmDialogView({ request }: { request: ConfirmRequest }) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const messageId = useId();
  const tone = request.tone ?? 'default';
  const requiresText = Boolean(request.requireText);
  const canConfirm = !requiresText || typed.trim() === request.requireText;

  // أسماء لا تحجب `window.confirm` (ولا تلتبس به عند القراءة أو التدقيق)
  const dismiss = () => settleConfirm(request.id, false);
  const accept = () => {
    if (canConfirm) settleConfirm(request.id, true);
  };

  // زر الرجوع (أندرويد/الفأرة) و Escape = إلغاء، مثل أي نافذة في التطبيق
  useModalCloser(true, dismiss, { label: 'حوار تأكيد' });

  const Icon = tone === 'danger' ? Trash2 : tone === 'warning' ? AlertTriangle : HelpCircle;
  const paragraphs = (request.message ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={paragraphs.length ? messageId : undefined}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 animate-slide-up"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0',
              tone === 'danger'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : tone === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                  : 'bg-primary-50 dark:bg-primary-900/20 text-primary-600'
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-gray-900 dark:text-white leading-relaxed">
              {request.title}
            </h2>
            {paragraphs.length > 0 && (
              <div id={messageId} className="mt-2 space-y-1.5 text-sm text-gray-600 dark:text-gray-300 leading-relaxed break-words">
                {paragraphs.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            )}
            {request.details && request.details.length > 0 && (
              <ul className="mt-3 list-disc pr-5 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                {request.details.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {requiresText && (
          <form
            className="mt-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              accept();
            }}
          >
            <label className="text-xs font-medium text-gray-700 dark:text-gray-200 block mb-1.5">
              للتأكيد اكتب: <strong className="text-red-600 dark:text-red-400">{request.requireText}</strong>
            </label>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus
              autoComplete="off"
              aria-label={`اكتب ${request.requireText} للتأكيد`}
            />
          </form>
        )}

        <div className="flex gap-2 mt-6">
          <Button
            variant={tone === 'danger' ? 'destructive' : 'default'}
            className="flex-1"
            onClick={accept}
            disabled={!canConfirm}
          >
            {request.confirmText ?? 'تأكيد'}
          </Button>
          {/* التركيز المبدئي على الإجراء الآمن — ممارسة قياسية لحوارات التأكيد */}
          <Button variant="outline" className="flex-1" onClick={dismiss} autoFocus={!requiresText}>
            {request.cancelText ?? 'إلغاء'}
          </Button>
        </div>
      </div>
    </div>
  );
}
