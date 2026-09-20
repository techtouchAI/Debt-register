/**
 * مكدس النوافذ المنبثقة (Modals/Dialogs).
 *
 * الهدف: زر الرجوع في أندرويد يجب أن يُغلق النافذة المفتوحة أولاً بدل الخروج
 * من التطبيق. كل نافذة تُسجّل دالة إغلاقها عند فتحها وتُزيلها عند إغلاقها،
 * ومعالج زر الرجوع يُغلق الأحدث فقط (LIFO).
 */

type ModalCloser = () => void;

const stack: ModalCloser[] = [];

export function pushModalCloser(closer: ModalCloser): () => void {
  stack.push(closer);
  return () => {
    const index = stack.lastIndexOf(closer);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

/** يُغلق أحدث نافذة. يُعيد true إذا وُجدت نافذة وأُغلقت. */
export function closeTopModal(): boolean {
  const closer = stack.pop();
  if (!closer) return false;
  try {
    closer();
  } catch (error) {
    console.warn('تعذّر إغلاق النافذة:', error);
  }
  return true;
}
