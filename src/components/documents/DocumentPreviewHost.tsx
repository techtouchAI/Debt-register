import { useEffect, useSyncExternalStore } from 'react';
import { DocumentPreviewDialog } from './DocumentPreviewDialog';
import {
  closeDocumentPreview,
  getActiveDocumentPreview,
  subscribeDocumentPreview
} from '@/lib/documentPreview';

/**
 * مُضيف نافذة معاينة المستندات (يُركَّب مرة واحدة في جذر التطبيق).
 *
 * انظر `lib/documentPreview.ts` لسبب وجود مخزن مركزي: كل إجراء على كل شاشة
 * (طباعة/حفظ/عرض) يحتاج عرض المستند نفسه، فلم تبقَ كل صفحة تُكرّر حالة
 * المعاينة ونافذتها. وهذا هو نفس نمط `ConfirmDialogHost` المعتمد هنا.
 */
export function DocumentPreviewHost() {
  const request = useSyncExternalStore(subscribeDocumentPreview, getActiveDocumentPreview, getActiveDocumentPreview);

  // إلغاء تركيب المضيف (الانتقال بين شاشة الدخول والتطبيق) يُغلق أي معاينة
  // معلّقة بدل تركها تنتظر بلا نهاية.
  useEffect(() => () => closeDocumentPreview(), []);

  if (!request) return null;

  // مفتاح لكل مستند: حالة الرسالة المحلية تبدأ نظيفة مع كل معاينة جديدة
  return (
    <DocumentPreviewDialog
      key={`${request.title}-${request.fileNameBase}`}
      open
      title={request.title}
      bodyHtml={request.bodyHtml}
      fileNameBase={request.fileNameBase}
      pdfFormat={request.pdfFormat}
      shareTitle={request.shareTitle}
      notice={request.notice}
      onClose={closeDocumentPreview}
    />
  );
}
