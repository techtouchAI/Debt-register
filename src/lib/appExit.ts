/**
 * الخروج النهائي من التطبيق — مسار موحّد لكل المنصات.
 *
 * القاعدة: التطبيق لا يخرج أبداً بضغطة رجوع واحدة؛ الخروج يمر دائماً عبر
 * حوار تأكيد صريح (انظر `ExitConfirmDialog`). هذه الوحدة تنفّذ الخروج الفعلي
 * بعد التأكيد حسب المنصة:
 *   - أندرويد (Capacitor): `App.exitApp()`.
 *   - ويندوز (Electron): إغلاق النافذة، و`window-all-closed` يُنهي التطبيق.
 *   - ويندوز/لينكس (Tauri): إغلاق النافذة الرئيسية عبر واجهة Tauri العامة
 *     (صلاحية `core:window:allow-close`) — آخر نافذة تُنهي التطبيق.
 *   - المتصفح العادي: لا يمكن برمجياً إغلاق التبويب — تُعيد الدالة `false`
 *     والمتصل يعرض رسالة مناسبة بدل حوار تأكيد.
 *
 * قبل الخروج نرفع علامة الإغلاق (`beginShutdown`) حتى تتوقف أي عمليات كتابة
 * متأخرة في قاعدة البيانات ولا تظهر أخطاء `DatabaseClosedError` كملاحظات
 * خطأ للمستخدم لحظة الإغلاق.
 */
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { getElectronAPI, getTauri } from '@/lib/platform';
import { beginShutdown, endShutdown } from '@/lib/lifecycle';

function isCapacitorNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** هل الخروج البرمجي ممكن على هذه المنصة؟ (يقرر إظهار حوار التأكيد أصلاً) */
export function canExitApp(): boolean {
  if (isCapacitorNative()) return true;
  if (getElectronAPI()) return true;
  return typeof getTauri()?.window?.getCurrentWindow === 'function';
}

/**
 * تنفيذ الخروج بعد تأكيد المستخدم.
 * @returns true إذا نُفّذ الخروج فعلياً عبر المنصة.
 */
export async function exitApplication(): Promise<boolean> {
  beginShutdown('app-exit');

  if (isCapacitorNative()) {
    try {
      await CapacitorApp.exitApp();
      return true;
    } catch (error) {
      console.warn('تعذّر الخروج عبر المنصة الأصلية:', error);
    }
  }

  if (getElectronAPI()) {
    window.close();
    return true;
  }

  const tauriWindow = getTauri()?.window;
  if (tauriWindow?.getCurrentWindow) {
    try {
      await tauriWindow.getCurrentWindow().close();
      return true;
    } catch (error) {
      console.warn('تعذّر إغلاق نافذة سطح المكتب:', error);
    }
  }

  // لم يُنفَّذ الخروج: نرفع علامة الإغلاق حتى تعود قاعدة البيانات للعمل
  // (وإلا بقي التطبيق مفتوحاً وكل عملية حفظ تُرفض كأنه يُغلق).
  endShutdown();
  return false;
}
