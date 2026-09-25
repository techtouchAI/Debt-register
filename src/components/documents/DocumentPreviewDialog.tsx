import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Download, X, Loader2, FileText, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildPrintDocument, printHtmlDocument, systemPrintAvailable, PRINT_FALLBACK_NOTICE } from '@/lib/print';
import { generatePdfFromBodyHtml } from '@/lib/pdf';
import { sheetRenderWidthPx } from '@/lib/pageLayout';
import { useModalCloser } from '@/hooks/useModalCloser';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';

/**
 * نافذة معاينة المستندات الموحّدة (فاتورة / وصل / كشف حساب).
 *
 * تعرض **الورقة نفسها** التي تُطبع وتُحفظ: نفس المقاسات بالملّيمتر ونفس
 * الهوامش (انظر `pageLayout.ts`)، وتُحجَّم لتناسب عرض النافذة على الشاشات
 * الضيقة بلا تغيير في تخطيط المستند نفسه.
 *
 * ولا يعتمد زر «طباعة» على نجاح صامت: إن لم يُفتح حوار الطباعة (جهاز لا
 * يدعمه أو نافذة مُقيَّدة) تظهر رسالة توضّح البديل داخل النافذة نفسها بدل
 * ضغطة بلا أثر.
 */

interface DocumentPreviewDialogProps {
  open: boolean;
  title: string;
  /** جسم المستند من قوالب print.ts */
  bodyHtml: string;
  /** اسم ملف المستند عند الحفظ (بدون لاحقة) */
  fileNameBase: string;
  pdfFormat?: 'a4' | 'receipt80';
  shareTitle?: string;
  /** رسالة توضيحية اختيارية أعلى المستند (تعرض عند تعذّر حوار الطباعة) */
  notice?: string;
  onClose: () => void;
}

export function DocumentPreviewDialog({
  open,
  title,
  bodyHtml,
  fileNameBase,
  pdfFormat = 'a4',
  shareTitle,
  notice,
  onClose
}: DocumentPreviewDialogProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  // عرض حاوية العرض: تُحجَّم الورقة إليه فلا يلزم تمرير أفقي على الهاتف
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const pane = paneRef.current;
    if (!open || !pane) return;
    const measure = () => setPaneWidth(pane.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [open]);

  // أوسع ورقة (A4) هي مرجع التصغير حتى لا يتغيّر مقاس العرض بين المستندات
  const documentHtml = useMemo(
    () =>
      open
        ? buildPrintDocument(title, bodyHtml, {
            view: 'preview',
            ...(paneWidth > 0 ? { fitWidthPx: paneWidth - 24 } : {})
          })
        : '',
    [open, title, bodyHtml, paneWidth]
  );

  const canPrint = systemPrintAvailable();
  const activeNotice = localNotice ?? notice ?? (canPrint ? null : PRINT_FALLBACK_NOTICE.unsupported);

  // زر الرجوع (أندرويد/سطح المكتب) و Escape يُغلقان المعاينة وحدها، وقفل
  // تمرير الخلفية يتم مركزياً في `useModalCloser` (عدّاد مراجع مشترك بين
  // كل الطبقات — كان الضبط اليدوي هنا يعيد التمرير للخلفية بمجرد إغلاق
  // أي طبقة أخرى قبلها).
  useModalCloser(open, onClose, { label: 'معاينة المستند' });

  const handlePrint = useCallback(async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const outcome = await printHtmlDocument(title, bodyHtml);
      if (outcome !== 'printed') {
        // لا حوار طباعة هنا: نوضّح البديل داخل النافذة بدل إظهار لا شيء
        setLocalNotice(PRINT_FALLBACK_NOTICE[outcome]);
      } else {
        setLocalNotice(null);
      }
    } catch (error) {
      reportError('Preview.print', error, 'تعذّر الطباعة');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, title, bodyHtml]);

  const handleExportPdf = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const saved = await generatePdfFromBodyHtml(bodyHtml, fileNameBase, shareTitle || title, pdfFormat);
      if (saved) toast.success('تم حفظ المستند', saved.message);
    } catch (error) {
      reportError('Preview.pdf', error, 'تعذّر حفظ المستند');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, bodyHtml, fileNameBase, shareTitle, title, pdfFormat]);

  if (!open) return null;

  const busy = isPrinting || isExporting;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-4xl h-[92vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-sm sm:text-base truncate">
            <FileText className="w-5 h-5 text-primary-600 flex-shrink-0" />
            <span className="truncate">معاينة: {title}</span>
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="إغلاق المعاينة">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {activeNotice && (
          <div
            role="status"
            data-testid="document-preview-notice"
            className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0">{activeNotice}</p>
          </div>
        )}

        <div ref={paneRef} className="flex-1 bg-gray-100 dark:bg-gray-950 p-3 sm:p-4 overflow-hidden">
          <iframe
            title={title}
            srcDoc={documentHtml}
            sandbox=""
            className="w-full h-full bg-white rounded-xl border border-gray-200 dark:border-gray-700 shadow-inner"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <Button onClick={handlePrint} disabled={busy} className="bg-primary-600 hover:bg-primary-700 flex-1 sm:flex-none">
            {isPrinting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Printer className="w-4 h-4 ml-2" />}
            طباعة
          </Button>
          <Button variant="outline" onClick={handleExportPdf} disabled={busy} className="flex-1 sm:flex-none" data-testid="document-preview-save">
            {isExporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
            حفظ كمستند
          </Button>
          <span className="hidden text-[11px] text-gray-500 sm:inline">
            الورقة {pdfFormat === 'receipt80' ? 'حرارية 80 مم' : 'A4'} — عرض {sheetRenderWidthPx(pdfFormat)} بكسل بالحجم الحقيقي
          </span>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="mr-auto">
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}
