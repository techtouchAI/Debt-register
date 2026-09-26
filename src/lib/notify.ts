import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import { getElectronAPI, isTauri } from './platform';
import { requestTauriNotificationPermission, sendTauriNotification, tauriNotificationAllowed } from './tauriShell';

/**
 * خدمة الإشعارات الموحّدة.
 *
 * المشكلة السابقة: الإشعارات كانت تُحفظ في قاعدة البيانات فقط (داخل التطبيق)،
 * ومحاولة إشعار النظام كانت تستخدم `window.Capacitor.Plugins` القديمة دون طلب
 * إذن ودون قناة إشعارات — فلا يصل شيء لنظام أندرويد إطلاقاً.
 *
 * التصميم الجديد:
 *  - أندرويد (Capacitor): LocalNotifications الرسمية + قناة مخصصة + طلب إذن صريح.
 *  - ويندوز (Electron): إشعار نظام عبر العملية الرئيسية (موجود مسبقاً).
 *  - المتصفح: Web Notifications API عند توفرها والإذن ممنوح.
 */

/**
 * اسم التطبيق الظاهر في الإشعارات التي لا تحمل عنواناً صريحاً.
 * اسم عام لا يرتبط بنشاط بعينه (مكتب/سوبر ماركت/أي نشاط) — والمستخدم هو من
 * يختار اسم مكتبه في الإعدادات، وهذا يظهر فقط كعنوان احتياطي للإشعارات.
 */
const APP_NAME = 'إدارة المكتب';

const CHANNEL_ID = 'agri-office-default';

let channelReady = false;

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function ensureAndroidChannel(): Promise<void> {
  if (channelReady) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'تنبيهات المكتب',
      description: 'تنبيهات المخزون والديون والنسخ الاحتياطي',
      importance: 4, // HIGH: صوت + ظهور في الشريط
      visibility: 1, // PUBLIC
      sound: undefined,
      vibration: true
    });
    channelReady = true;
  } catch (error) {
    console.warn('تعذّر إنشاء قناة الإشعارات:', error);
  }
}

export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** حالة إذن إشعارات النظام على المنصة الحالية (دون طلب). */
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (isNative()) {
    try {
      const status: PermissionStatus = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') return 'granted';
      if (status.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  if (getElectronAPI()) return 'granted'; // Electron يعرض مباشرة عبر العملية الرئيسية

  if (isTauri()) {
    try {
      return (await tauriNotificationAllowed()) ? 'granted' : 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    const permission = window.Notification.permission;
    if (permission === 'granted') return 'granted';
    if (permission === 'denied') return 'denied';
    return 'prompt';
  }
  return 'unsupported';
}

/**
 * طلب إذن إشعارات النظام.
 * - على أندرويد: يطلب إذن POST_NOTIFICATIONS (أندرويد 13+) وينشئ القناة.
 * - على المتصفح: يطلب الإذن فقط في السياق الآمن (https/localhost).
 * يُعيد true إذا أصبح الإذن ممنوحاً.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNative()) {
    try {
      const status = await LocalNotifications.requestPermissions();
      const granted = status.display === 'granted';
      if (granted) await ensureAndroidChannel();
      return granted;
    } catch (error) {
      console.warn('تعذّر طلب إذن الإشعارات:', error);
      return false;
    }
  }

  if (getElectronAPI()) return true;

  if (isTauri()) {
    try {
      return await requestTauriNotificationPermission();
    } catch (error) {
      console.warn('تعذّر طلب إذن إشعارات سطح المكتب:', error);
      return false;
    }
  }

  try {
    if (typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext) {
      if (window.Notification.permission === 'granted') return true;
      if (window.Notification.permission === 'denied') return false;
      const result = await window.Notification.requestPermission();
      return result === 'granted';
    }
  } catch (error) {
    console.warn('تعذّر طلب إذن إشعارات المتصفح:', error);
  }
  return false;
}

/**
 * تهيئة صامتة عند بدء التطبيق: إنشاء القناة إذا كان الإذن ممنوحاً مسبقاً.
 * لا تطلب الإذن تلقائياً حتى لا تُزعج المستخدم — الطلب يتم من صفحة
 * الإشعارات أو عند أول تنبيه مهم (حسب استدعاء الواجهة).
 */
export async function initSystemNotifications(): Promise<void> {
  if (!isNative()) return;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') await ensureAndroidChannel();
  } catch (error) {
    console.warn('تعذّر تهيئة إشعارات النظام:', error);
  }
}

let lastNotificationId = 0;

function nextNotificationId(): number {
  lastNotificationId = (lastNotificationId + 1) % 100000;
  // معرّف موجب فريد تقريباً — مطلوب من الإضافة الأصلية
  return Date.now() % 1000000 * 10 + lastNotificationId % 10 + 1;
}

/**
 * إرسال إشعار فوري لنظام التشغيل (خارج التطبيق).
 * لا ترمي استثناءً أبداً — الفشل يُسجَّل في الطرفية فقط لأن إشعار النظام
 * تحسين إضافي وليس جزءاً حرجاً من حفظ البيانات.
 */
export async function sendSystemNotification(title: string, message: string): Promise<boolean> {
  const safeTitle = String(title || APP_NAME).slice(0, 100);
  const safeBody = String(message || '').slice(0, 300);

  // 1) أندرويد أصلي
  if (isNative()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') return false;
      await ensureAndroidChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: nextNotificationId(),
            title: safeTitle,
            body: safeBody,
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_icon_config_sample',
            autoCancel: true,
            ongoing: false
            // بدون schedule: عرض فوري
          }
        ]
      });
      return true;
    } catch (error) {
      console.warn('تعذّر إرسال إشعار أندرويد:', error);
      return false;
    }
  }

  // 2) ويندوز (Electron)
  try {
    const electronAPI = getElectronAPI();
    if (electronAPI?.showNotification) {
      await electronAPI.showNotification(safeTitle, safeBody);
      return true;
    }
  } catch (error) {
    console.warn('تعذّر إرسال إشعار سطح المكتب:', error);
  }

  if (isTauri()) {
    try {
      return await sendTauriNotification(safeTitle, safeBody);
    } catch (error) {
      console.warn('تعذّر إرسال إشعار سطح المكتب:', error);
      return false;
    }
  }

  // 3) المتصفح
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
      new window.Notification(safeTitle, { body: safeBody });
      return true;
    }
  } catch (error) {
    console.warn('تعذّر إرسال إشعار المتصفح:', error);
  }

  return false;
}
