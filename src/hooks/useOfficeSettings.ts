import { useSyncExternalStore } from 'react';
import { readSettingsSnapshot, subscribeSettings } from '@/lib/settingsStore';
import type { OfficeSettings } from '@/types';

/**
 * قراءة إعدادات المكتب من المخزن المشترك.
 *
 * لا ينشئ هذا الخطاف استعلاماً حيّاً خاصاً به: القيمة تُنشَر من مسار الكتابة
 * (`updateSettings`) ومن كل قراءة (`getSettings`)، فتُعرض القيمة المحفوظة في
 * أول رسم بعد الحفظ بدل انتظار وصول استعلام Dexie الحيّ.
 *
 * `fallback` يبقى للاستخدام الخاص بحالة الإقلاع (قيمة قرأها `App` قبل تركيب
 * التخطيط) فلا تظهر أبداً ترويسة باسم افتراضي مع وجود اسم محفوظ.
 */
export function useOfficeSettings(fallback: OfficeSettings | null = null): OfficeSettings | null {
  const published = useSyncExternalStore(subscribeSettings, readSettingsSnapshot, readSettingsSnapshot);
  return published ?? fallback;
}
