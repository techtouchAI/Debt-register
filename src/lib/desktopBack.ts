/**
 * طلبات الرجوع على سطح المكتب (Electron على ويندوز، والمتصفح/PWA).
 *
 * المشكلة: زر الفأرة الخلفي و Alt+← لم يمرّا بقواعد الرجوع الموحّدة:
 *   - Electron على ويندوز لا يرجع أصلاً بزر الفأرة (يرسل `app-command` فقط)
 *     ولا يملك اختصار Alt+← إطلاقاً ⇒ الزر "ميت".
 *   - في المتصفح/لينكس يرجع Chromium في السجل مباشرة ⇒ من الرئيسية يغادر إلى
 *     صفحات قديمة أو يخرج بدل حوار تأكيد الخروج.
 *
 * الحل: نلتقط الإشارتين داخل الصفحة نفسها ونلغي سلوك المتصفح الافتراضي
 * (Chromium يسمح بإلغاء تنقّل أزرار الفأرة الجانبية عبر preventDefault على
 * mouseup، ويمرّر Alt+← للصفحة أولاً)، ثم نمرّر الطلب لنفس معالج زر أندرويد.
 * بهذا تعمل الأزرار بنفس الطريقة في كل المنصات، وبلا أي تنقّل مزدوج.
 */

/** زر الفأرة الجانبي الخلفي حسب مواصفة UI Events (`MouseEvent.button`). */
export const MOUSE_BACK_BUTTON = 3;

export type BackRequestSource = 'mouse' | 'keyboard';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * هل هذه الضغطة اختصار "رجوع"؟
 *   - ويندوز/لينكس: Alt+← (الاختصار القياسي في المتصفحات).
 *   - ماك: ⌘+[ دائماً، و ⌘+← خارج حقول الكتابة فقط (داخلها تعني "بداية السطر").
 */
export function isBackShortcut(event: KeyboardEvent, mac = isMacPlatform()): boolean {
  if (event.isComposing || event.defaultPrevented) return false;
  if (mac) {
    if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
    if (event.key === '[') return true;
    return event.key === 'ArrowLeft' && !isEditableTarget(event.target);
  }
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowLeft';
}

/**
 * تثبيت مستمعي الرجوع لسطح المكتب.
 * @returns دالة الإزالة.
 */
export function installDesktopBack(onBack: (source: BackRequestSource) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  // Chromium يبدأ التنقّل عند mousedown/mouseup للزر الجانبي حسب المنصة؛
  // نلغي الاثنين ونطلق الطلب مرة واحدة فقط (عند الإفلات، مثل النقر العادي).
  const onMouseDown = (event: MouseEvent) => {
    if (event.button === MOUSE_BACK_BUTTON) event.preventDefault();
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== MOUSE_BACK_BUTTON) return;
    event.preventDefault();
    onBack('mouse');
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isBackShortcut(event)) return;
    event.preventDefault();
    if (event.repeat) return; // الضغط المطوّل لا يرجع عدة صفحات دفعة واحدة
    onBack('keyboard');
  };

  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
