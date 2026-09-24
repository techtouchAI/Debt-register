/**
 * حوار التأكيد داخل التطبيق (بديل `window.confirm` و `window.prompt`).
 *
 * لماذا لا نستخدم حوارات المتصفح الأصلية؟
 *   - في نسخة ويندوز (Electron) أزرار `confirm()` مكتوبة بالإنجليزية دائماً
 *     (OK / Cancel) ولا يمكن تعريبها، وعنوان الحوار اسم تقني.
 *   - `prompt()` غير مدعوم إطلاقاً في Electron (يُرجع فراغاً فوراً)، فكان
 *     "حذف جميع البيانات" يفشل دائماً على ويندوز بينما يعمل على أندرويد.
 *   - في أندرويد تظهر أزرار الحوار الأصلي بلغة النظام لا بلغة التطبيق.
 *
 * هنا: طلب تأكيد يُعيد وعداً (Promise<boolean>) ويعرضه مكوّن واحد
 * (`ConfirmDialogHost`) بتصميم التطبيق وبالعربية على كل المنصات، ويُغلق بزر
 * الرجوع/Escape كأي نافذة (يُعتبر إلغاءً). الطلبات المتزامنة تُعرض بالترتيب.
 */

export type ConfirmTone = 'danger' | 'warning' | 'default';

export interface ConfirmOptions {
  title: string;
  /** نص الرسالة (كل سطر فقرة مستقلة) */
  message?: string;
  /** نقاط توضيحية تحت الرسالة */
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  /** نص يجب أن يكتبه المستخدم حرفياً لتفعيل زر التأكيد (للعمليات الخطيرة) */
  requireText?: string;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

interface PendingRequest {
  request: ConfirmRequest;
  resolve: (confirmed: boolean) => void;
}

const queue: PendingRequest[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('تعذّر تحديث حوار التأكيد:', error);
    }
  }
}

/** الطلب المعروض حالياً (الأقدم في الطابور). */
export function getActiveConfirm(): ConfirmRequest | null {
  return queue[0]?.request ?? null;
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * طلب تأكيد من المستخدم.
 * @returns true عند الضغط على زر التأكيد، false عند الإلغاء/الرجوع/Escape.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (listeners.size === 0) {
    // لا يوجد مكوّن عرض مركّب (لا يحدث داخل التطبيق): الرفض أسلم من تنفيذ
    // عملية حذف بلا تأكيد أو من الرجوع لحوار أصلي بأزرار إنجليزية.
    console.error('حوار التأكيد غير مركّب — أُلغيت العملية');
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    queue.push({ request: { ...options, id: nextId++ }, resolve });
    emit();
  });
}

/** إنهاء الطلب المعروض بنتيجة (يستدعيه مكوّن العرض). */
export function settleConfirm(id: number, confirmed: boolean): void {
  const index = queue.findIndex((entry) => entry.request.id === id);
  if (index === -1) return;
  const [entry] = queue.splice(index, 1);
  emit();
  entry.resolve(confirmed);
}

/** إلغاء كل الطلبات المعلّقة (عند إلغاء تركيب المكوّن أو في الاختبارات). */
export function cancelAllConfirms(): void {
  const pending = queue.splice(0, queue.length);
  if (pending.length) emit();
  for (const entry of pending) entry.resolve(false);
}
