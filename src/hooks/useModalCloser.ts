import { useEffect, useLayoutEffect, useRef } from 'react';
import { pushModalCloser, type ModalCloserOptions } from '@/lib/modalStack';

/**
 * ربط طبقة معروضة (نافذة/درج جانبي/معاينة) بأزرار الرجوع.
 *
 * يُسجّل دالة الإغلاق في مكدس الطبقات عند الفتح ويُزيلها عند الإغلاق، فيعمل
 * زر الرجوع (أندرويد) وزر الفأرة الخلفي ( Electron/Tauri/المتصفح) و Escape
 * على إغلاق الطبقة العليا وحدها.
 *
 * ملاحظة: مستمع Escape مركزي في `lib/modalStack.ts` — لا تُضِف مستمعاً
 * محلياً في كل نافذة، فذلك كان يجعل Escape يُغلق كل النوافذ المفتوحة معاً.
 */
export function useModalCloser(open: boolean, onClose: () => void, options?: ModalCloserOptions): void {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const escape = options?.escape !== false;
  const label = options?.label ?? 'طبقة';

  useEffect(() => {
    if (!open) return;
    return pushModalCloser(() => closeRef.current(), { escape, label });
  }, [open, escape, label]);
}
