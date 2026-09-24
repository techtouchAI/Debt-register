import { setTheme, type ThemeName } from '@/hooks/useTheme';
import { updateSettings } from './db';
import { logBackgroundFailure } from './lifecycle';

/**
 * سمة الواجهة جزء من إعدادات المكتب (وتنتقل مع النسخة الاحتياطية).
 *
 * سابقاً كانت السمة تُحفظ في التخزين المحلي للمتصفح فقط وتُكتب في قاعدة
 * البيانات عند الضغط على "حفظ الإعدادات"، فتخرج النسخة الاحتياطية بسمة قديمة
 * ولا تُطبَّق السمة المستعادة. الآن كل تبديل يُحفظ في الموضعين فوراً.
 */
export function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark';
}

/** تبديل السمة من الواجهة: تُطبَّق فوراً وتُحفظ في إعدادات المكتب. */
export function saveThemePreference(theme: ThemeName): void {
  setTheme(theme);
  void updateSettings({ theme }).catch((error) => logBackgroundFailure('تعذّر حفظ سمة الواجهة:', error));
}

/** تطبيق سمة محفوظة (بعد استعادة نسخة احتياطية) إن كانت قيمة صالحة. */
export function applyThemePreference(theme: unknown): void {
  if (isThemeName(theme)) setTheme(theme);
}
