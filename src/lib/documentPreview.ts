import type { PdfFormat } from './pageLayout';

/**
 * نافذة معاينة المستندات الموحّدة — حالة على مستوى التطبيق.
 *
 * لماذا مخزن لا حالة صفحة؟ لأن أي إجراء على أي شاشة (طباعة/حفظ/عرض) يحتاج
 * إظهار المستند نفسه، وكانت كل صفحة تكرّر حالة المعاينة ونافذتها. الآن
 * يوجد مُضيف واحد في جذر التطبيق (`DocumentPreviewHost`) وأي شاشة تفتح
 * المعاينة بسطر واحد — وهذا هو نفس نمط `confirm.ts` وحواره المعتمد في
 * التطبيق (مخزن + مُضيف واحد).
 */

export interface DocumentPreviewRequest {
  /** عنوان النافذة (يظهر أيضاً في تبويب الإطار) */
  title: string;
  /** جسم المستند من قوالب `print.ts` */
  bodyHtml: string;
  /** اسم الملف عند الحفظ (بلا لاحقة) */
  fileNameBase: string;
  shareTitle?: string;
  pdfFormat?: PdfFormat;
  /** رسالة توضيحية اختيارية أعلى المستند (مثل: طباعة غير متاحة على هذا الجهاز) */
  notice?: string;
}

let active: DocumentPreviewRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('تعذّر تحديث نافذة المعاينة:', error);
    }
  }
}

export function openDocumentPreview(request: DocumentPreviewRequest): void {
  active = request;
  emit();
}

export function closeDocumentPreview(): void {
  if (active === null) return;
  active = null;
  emit();
}

export function getActiveDocumentPreview(): DocumentPreviewRequest | null {
  return active;
}

export function subscribeDocumentPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
