import { getArabicErrorMessage } from './errors'

/**
 * نظام تنبيهات خفيف داخل التطبيق (بدون مكتبات خارجية).
 * يُستخدم لإظهار الأخطاء للبدل من الصمت التام أو alert() الذي يحجب الواجهة.
 */

export type ToastKind = 'error' | 'success' | 'info' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

type Listener = (toasts: Toast[]) => void

const listeners = new Set<Listener>()
let toasts: Toast[] = []
let nextId = 1

const MAX_VISIBLE = 4

function emit() {
  for (const listener of listeners) {
    try {
      listener(toasts)
    } catch (error) {
      console.warn('تعذّر تحديث التنبيهات:', error)
    }
  }
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => {
    listeners.delete(listener)
  }
}

/** تنظيف وترجمة أي نص أو عنوان بالإنجليزية قبل إرساله إلى التوست */
function sanitizeToastText(text: string | undefined): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (lower === 'error') return 'خطأ'
  if (lower === 'success') return 'نجاح'
  if (lower === 'info') return 'معلومات'
  if (lower === 'warning') return 'تنبيه'
  if (lower === 'ok') return 'موافق'
  if (lower === 'cancel') return 'إلغاء'

  // إذا كان النص يحتوي على خطأ إنجليزي أو كود
  if (/^[a-z0-9_\-\s:.,!?()]+$/i.test(trimmed) && !trimmed.includes('PDF') && !trimmed.includes('JSON')) {
    return getArabicErrorMessage(trimmed)
  }

  return trimmed
}

export function pushToast(kind: ToastKind, title: string, message?: string): number {
  const id = nextId++
  const cleanTitle = sanitizeToastText(title) || 'تنبيه'
  const cleanMessage = sanitizeToastText(message)

  toasts = [...toasts, { id, kind, title: cleanTitle, message: cleanMessage }].slice(-MAX_VISIBLE)
  emit()
  return id
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

export const toast = {
  error: (title: string, message?: string) => pushToast('error', title, message),
  success: (title: string, message?: string) => pushToast('success', title, message),
  info: (title: string, message?: string) => pushToast('info', title, message),
  warning: (title: string, message?: string) => pushToast('warning', title, message)
}
