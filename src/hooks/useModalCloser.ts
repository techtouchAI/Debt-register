import { useEffect, useRef } from 'react';
import { pushModalCloser } from '@/lib/modalStack';

/**
 * ربط نافذة منبثقة بزر الرجوع وزر Escape.
 * يُسجّل دالة الإغلاق في مكدس النوافذ عند فتحها ويُزيلها عند إغلاقها،
 * فيُغلق زر الرجوع في أندرويد النافذة بدل الخروج من التطبيق.
 */
export function useModalCloser(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const stableClose = () => closeRef.current();
    const release = pushModalCloser(stableClose);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      release();
      window.removeEventListener('keydown', onKey);
    };
  }, [open ]);
}
