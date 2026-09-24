import { formatErrorMessage, isLikelyEnglishError, UNKNOWN_ERROR_MESSAGE } from './errors'

/**
 * نظام تنبيهات خفيف داخل التطبيق (بدون مكتبات خارجية).
 * يُستخدم لإظهار الأخطاء بدلاً من الصمت التام أو alert() الذي يحجب الواجهة.
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

/**
 * بوابة موحّدة قبل تخزين أي نص في التوست.
 *
 * الرسائل الإنجليزية المعروفة (Network Error و timeout و Ok و Cancel وغيرها)
 * تُترجم عبر المهيّئ المركزي في `errors.ts`. أما النصوص التي ليست أخطاء،
 * مثل اسم ملف أو اسم عميل إنجليزي، فتبقى كما هي في رسائل النجاح والمعلومات.
 */
export function formatToastText(text: string | undefined, kind: ToastKind): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const formatted = formatErrorMessage(trimmed)
  if (formatted === UNKNOWN_ERROR_MESSAGE && kind !== 'error' && !isLikelyEnglishError(trimmed)) {
    return trimmed
  }
  return formatted
}

export function pushToast(kind: ToastKind, title: string, message?: string): number {
  const id = nextId++
  const cleanTitle = formatToastText(title, kind) || 'تنبيه'
  const cleanMessage = formatToastText(message, kind)

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
