import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react'
import { dismissToast, subscribeToasts, type Toast, type ToastKind } from '@/lib/toast'
import { cn } from '@/lib/utils'

const STYLES: Record<ToastKind, { wrapper: string; icon: typeof Info }> = {
  error: {
    wrapper: 'border-red-300 dark:border-red-800 bg-white dark:bg-gray-800 text-red-800 dark:text-red-200',
    icon: XCircle
  },
  success: {
    wrapper: 'border-green-300 dark:border-green-800 bg-white dark:bg-gray-800 text-green-800 dark:text-green-200',
    icon: CheckCircle
  },
  warning: {
    wrapper: 'border-amber-300 dark:border-amber-800 bg-white dark:bg-gray-800 text-amber-800 dark:text-amber-200',
    icon: AlertTriangle
  },
  info: {
    wrapper: 'border-blue-300 dark:border-blue-800 bg-white dark:bg-gray-800 text-blue-800 dark:text-blue-200',
    icon: Info
  }
}

const DURATION_MS: Record<ToastKind, number> = {
  error: 9000,
  warning: 6000,
  success: 4000,
  info: 4000
}

function ToastCard({ item }: { item: Toast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(item.id), DURATION_MS[item.kind])
    return () => window.clearTimeout(timer)
  }, [item.id, item.kind])

  const style = STYLES[item.kind]
  const Icon = style.icon

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-xl animate-slide-up',
        style.wrapper
      )}
    >
      <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-snug">{item.title}</p>
        {item.message ? <p className="text-xs mt-1 leading-relaxed break-words">{item.message}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        className="flex-shrink-0 rounded-md p-1 opacity-60 hover:opacity-100"
        aria-label="إغلاق التنبيه"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[100] flex flex-col gap-2">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
