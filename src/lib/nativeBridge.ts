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
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

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
  // الاستيراد ثابت: `@capacitor/core` مستورد أصلاً في مسار الإقلاع (الإشعارات
  // والملفات)، فالاستيراد الديناميكي هنا لم يكن يقسم شيئاً فعلاً — وكان يُنتج
  // تحذير Vite عن استيراد ديناميكي غير فعّال. الاستدعاء يبقى داخل try/catch
  // في `subscribeNativeBack` فلا يتعطل التطبيق إن لم تتوفر الإضافة.
  if (!Capacitor.isNativePlatform()) return undefined;
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

/* ------------------------------------------------------------------ *
 * المعالج النشط + الحارس المبكر
 * ------------------------------------------------------------------ */

/**
 * آلية القرار الواحد (Single Source of Back Handling):
 *
 *   - `setActiveNativeBackHandler` يسجّله المعالج الكامل (المدرك للمسار
 *     والطبقات) عند تركيبه.
 *   - `installNativeBackGuard` يشترك في حدث الرجوع **من أول لحظة في عمر
 *     التطبيق** (قبل رسم React)، فلا تبقى هناك لحظة يستطيع فيها زر الرجوع
 *     أن ينفّذ السلوك الافتراضي للمنصة (إنهاء النشاط على أندرويد).
 *
 * لماذا الحارس المبكر؟ على أندرويد يتصرّف `AppPlugin` هكذا: إن وُجد مستمع
 * JS واحد على الأقل لحدث `backButton` مرّر الضغطة إليه ولم يُنهِ التطبيق؛
 * وإن لم يوجد أي مستمع، تصرّف بنفسه (رجوع WebView أو إنهاء). فوجود مستمع
 * مبكر = لا إنهاء للتطبيق قبل أن تصبح الواجهة جاهزة للقرار.
 *
 * لا تكرار في المعالجة: الحارس لا يتصرّف إطلاقاً عندما يكون المعالج النشط
 * مسجّلاً — القرار يبقى في مكان واحد دائماً.
 */
export type NativeBackHandler = () => void;

let activeHandler: NativeBackHandler | null = null;
let guardInstalled = false;

/** يسجّل المعالج الكامل للرجوع (أو `null` عند إلغاء تركيبه). */
export function setActiveNativeBackHandler(handler: NativeBackHandler | null): void {
  activeHandler = handler;
}

/** هل المعالج الكامل مدرك للتركيب حالياً؟ */
export function hasActiveNativeBackHandler(): boolean {
  return activeHandler !== null;
}

/**
 * يثبّت حارساً مبكراً على حدث الرجوع الأصلي (يُستدعى مرة واحدة عند الإقلاع).
 * وجوده وحده يمنع المنصة من إنهاء التطبيق؛ ويتفوّض للمعالج النشط إن وُجد.
 */
export function installNativeBackGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  void subscribeNativeBack(() => {
    // المعالج النشط يتولّى القرار (وهو أيضاً مستمع مسجّل لدى المنصة).
    if (activeHandler) return;
    // لا معالج بعد (شاشة الإقلاع/معالج التشغيل الأول): نستهلك الضغطة
    // بلا إنهاء — لا يخرج التطبيق إلا بقرار صريح من المستخدم.
  });
}

/** إعادة حالة الحارس والمعالج النشط — للاختبارات فقط. */
export function resetNativeBackGuardForTests(): void {
  activeHandler = null;
  guardInstalled = false;
}
