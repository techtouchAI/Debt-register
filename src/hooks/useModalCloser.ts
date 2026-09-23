import { useEffect, useLayoutEffect, useRef } from 'react';
import { pushModalCloser, type ModalCloserOptions } from '@/lib/modalStack';
import { acquireBodyScrollLock } from '@/lib/scrollLock';

/**
 * ربط طبقة معروضة (نافذة/درج جانبي/معاينة) بأزرار الرجوع وقفل الخلفية.
 *
 * يُسجّل دالة الإغلاق في مكدس الطبقات عند الفتح ويُزيلها عند الإغلاق، فيعمل
 * زر الرجوع (أندرويد) وزر الفأرة الخلفي (Electron/Tauri/المتصفح) و Escape
 * على إغلاق الطبقة العليا وحدها.
 *
 * كما يستحوذ على قفل تمرير الخلفية (بعدّاد مراجع) ما دامت الطبقة مفتوحة،
 * فلا يتحرك محتوى الصفحة خلف النافذة أثناء التمرير داخلها أو عند تجاوز
 * حدودها — القفل يُرفع فقط بعد إغلاق **آخر** طبقة.
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

    const releaseScrollLock = acquireBodyScrollLock();
    const unregisterModal = pushModalCloser(() => closeRef.current(), { escape, label });

    return () => {
      unregisterModal();
      releaseScrollLock();
    };
  }, [open, escape, label]);
}
