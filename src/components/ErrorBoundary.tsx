import { Component, type ErrorInfo, type ReactNode } from 'react';
import { formatErrorMessage } from '@/lib/errors';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * حاجز أخطاء شامل: يمنع "الشاشة السوداء" عند أي استثناء أثناء العرض،
 * ويعرض رسالة مفهومة مع خيارات استرجاع (إعادة تحميل / مسح ذاكرة PWA).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  clearCacheAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.warn('Cache cleanup failed:', e);
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-cairo">
        <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-red-200 dark:border-red-900/50 p-6 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">حدث خطأ غير متوقع</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            توقف التطبيق عن العرض بدلًا من شاشة فارغة. بياناتك محفوظة محلياً ولم تتأثر.
          </p>
          <pre className="text-[11px] text-right bg-gray-100 dark:bg-gray-900 rounded-lg p-3 mb-4 overflow-auto max-h-32 text-gray-700 dark:text-gray-300">
            {formatErrorMessage(this.state.error)}
          </pre>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
            >
              إعادة المحاولة
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 text-sm font-medium"
            >
              إعادة تحميل الصفحة
            </button>
            <button
              onClick={this.clearCacheAndReload}
              className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-medium"
            >
              مسح ذاكرة التخزين المؤقت وإعادة التحميل
            </button>
          </div>
        </div>
      </div>
    );
  }
}
