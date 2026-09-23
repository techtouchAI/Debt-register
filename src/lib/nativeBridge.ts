/**
 * جسر "طلب الرجوع" من المنصات الأصلية.
 *
 * الهدف: فصل منطق الرجوع (في `backIntent.ts` و `modalStack.ts`) عن تفاصيل
 * الإضافة الأصلية، فتصبح:
 *   - قابلة للاختبار بضخّ حدث رجوع وهمي بلا أي محاكاة لـ Capacitor.
 *   - قابلة للتوسّع: أي غلاف مستقبلي (Tauri، غلاف مخصص) يسجّل مزوّده هنا.
 *
 * على أندرويد: `@capacitor/app` تُرسل حدث `backButton` فقط عند الضغط على زر
 * الرجوع في النظام، ويجب على التطبيق أن يقرر: إغلاق نافذة، أو رجوع شاشة،
 * أو البقاء (عدم الخروج). عدم استدعاء `exitApp` = البقاء في التطبيق.
 */

export interface NativeBackEvent {
  /** هل يمكن الرجوع في سجل WebView؟ (تُرسله Capacitor) */
  canGoBack: boolean;
  /** إغلاق التطبيق — لا يُستدعى أبداً في التطبيق إلا بقرار صريح. */
  exitApp: () => void;
}

export type NativeBackListener = (event: NativeBackEvent) => void;

export interface NativeBackSubscription {
  remove: () => Promise<void> | void;
}

export type NativeBackSubscriber = (
  listener: NativeBackListener
) => Promise<NativeBackSubscription | undefined> | NativeBackSubscription | undefined;

let subscriber: NativeBackSubscriber | null = null;
let customSubscriberSet = false;

/**
 * تسجيل مزوّد أحداث الرجوع (يُستخدم في الاختبارات أو في أغلفة مستقبلية).
 * تمرير `null` يُعيد المزوّد الافتراضي (Capacitor).
 */
export function setNativeBackSubscriber(next: NativeBackSubscriber | null): void {
  subscriber = next;
  customSubscriberSet = next !== null;
}

export function hasCustomNativeBackSubscriber(): boolean {
  return customSubscriberSet;
}

/**
 * المزوّد الافتراضي: `@capacitor/app` على المنصات الأصلية.
 * لا يعمل في المتصفح ولا في Electron/Tauri (هناك يكفي فخّ السجل + Alt+←).
 */
async function capacitorSubscriber(listener: NativeBackListener): Promise<NativeBackSubscription | undefined> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return undefined;
  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('backButton', ({ canGoBack }) => {
    listener({
      canGoBack: Boolean(canGoBack),
      exitApp: () => {
        // لا نستدعيها إلا من مسار صريح (لا يوجد حالياً) — تُترك للتوثيق.
        void App.exitApp();
      }
    });
  });
  return {
    remove: () => {
      void handle.remove();
    }
  };
}

/**
 * الاشتراك في أحداث الرجوع الأصلية.
 * يُعيد undefined إذا لم تكن المنصة تدعم حدث رجوع أصلياً.
 */
export async function subscribeNativeBack(
  listener: NativeBackListener
): Promise<NativeBackSubscription | undefined> {
  const provider = subscriber ?? capacitorSubscriber;
  try {
    return await provider(listener);
  } catch (error) {
    console.warn('تعذّر تسجيل مستمع زر الرجوع الأصلي:', error);
    return undefined;
  }
}
