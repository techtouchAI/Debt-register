import { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer, Download, X, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildPrintDocument, printHtmlDocument } from '@/lib/print';
import { generatePdfFromBodyHtml } from '@/lib/pdf';
import { useModalCloser } from '@/hooks/useModalCloser';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';

/**
 * نافذة معاينة المستندات الموحّدة (فاتورة / وصل / كشف حساب).
 *
 * المشكلة السابقة: زر "معاينة" كان يُنزّل ملفاً (أو لا يفعل شيئاً على
 * أندرويد)، والطباعة كانت تفتح نافذة منبثقة محظورة — فلا معاينة حقيقية
 * في أي صفحة. هذه النافذة تعرض المستند نفسه المستخدم في الطباعة وPDF
 * داخل إطار معزول، مع أزرار طباعة وتنزيل تعمل على كل المنصات.
 */

interface DocumentPreviewDialogProps {
  open: boolean;
  title: string;
  /** جسم المستند من قوالب print.ts */
  bodyHtml: string;
  /** اسم الملف عند تنزيل PDF (بدون لاحقة) */
  fileNameBase: string;
  pdfFormat?: 'a4' | 'receipt80';
  shareTitle?: string;
  onClose: () => void;
}

export function DocumentPreviewDialog({
  open,
  title,
  bodyHtml,
  fileNameBase,
  pdfFormat = 'a4',
  shareTitle,
  onClose
}: DocumentPreviewDialogProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const documentHtml = useMemo(() => (open ? buildPrintDocument(title, bodyHtml) : ''), [open, title, bodyHtml]);

  // زر الرجوع (أندرويد/سطح المكتب) و Escape يُغلقان المعاينة وحدها
  useModalCloser(open, onClose, { label: 'معاينة المستند' });

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handlePrint = useCallback(async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const printed = await printHtmlDocument(title, bodyHtml);
      if (!printed) {
        // أندرويد أصلي بلا حوار طباعة: نولّد PDF قابلاً للحفظ/المشاركة بدل لا شيء
        await generatePdfFromBodyHtml(bodyHtml, fileNameBase, shareTitle || title, pdfFormat);
        toast.success('تم تجهيز الملف', 'احفظه أو شاركه من نافذة المشاركة');
      }
    } catch (error) {
      reportError('Preview.print', error, 'تعذّر الطباعة');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, title, bodyHtml, fileNameBase, shareTitle, pdfFormat]);

  const handleExportPdf = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const fileName = await generatePdfFromBodyHtml(bodyHtml, fileNameBase, shareTitle || title, pdfFormat);
      toast.success('تم إنشاء ملف PDF', fileName);
    } catch (error) {
      reportError('Preview.pdf', error, 'تعذّر إنشاء ملف PDF');
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

        <div className="flex-1 bg-gray-100 dark:bg-gray-950 p-3 sm:p-4 overflow-hidden">
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
          <Button variant="outline" onClick={handleExportPdf} disabled={busy} className="flex-1 sm:flex-none">
            {isExporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
            تحميل PDF
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="mr-auto">
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}
