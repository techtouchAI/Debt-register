import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * إدارة سمة الواجهة (فاتح/داكن) كمصدر حقيقة واحد خارج React.
 *
 * لماذا ليس `useState` + `useEffect`؟
 *   الطريقة القديمة كانت تقرأ `localStorage` داخل `useEffect` ثم تستدعي
 *   `setState`، وهذا يسبب رسمًا متتالياً غير ضروري (وقاعدة
 *   react-hooks/set-state-in-effect تمنعه لأنه نمط غير صحي). كذلك فإن كل
 *   مكوّن كان يحتفظ بنسخته الخاصة من الحالة، فإذا بدّل المستخدم السمة من
 *   الإعدادات بقي زر التخطيط عالقاً على القيمة القديمة.
 *
 * الحل: حالة واحدة على مستوى الوحدة يقرأها `useSyncExternalStore`، فأي
 * مكوّن يعرض السمة يتحدّث فوراً، ويُطبَّق الصنف `dark` على `<html>` في مكان
 * واحد. القراءة أثناء أول رسم من التخزين المحلي مقصودة حتى لا تومض الواجهة
 * بالسمة الخطأ.
 */

export type ThemeName = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme';

let currentTheme: ThemeName | null = null;
const listeners = new Set<() => void>();

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function readStoredTheme(): ThemeName | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    /* التخزين المحلي غير متاح (وضع خاص) — نعتمد على تفضيل النظام */
    return null;
  }
}

/** السمة الحالية (بلا اشتراك) — تُستخدم أيضاً في الاختبارات. */
export function getTheme(): ThemeName {
  if (currentTheme === null) {
    currentTheme = readStoredTheme() ?? (prefersDark() ? 'dark' : 'light');
  }
  return currentTheme;
}

function applyThemeToDocument(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** تغيير السمة: تُحفظ وتُطبَّق وتُبلَّغ كل المكوّنات المشتركة. */
export function setTheme(theme: ThemeName): void {
  currentTheme = theme;
  applyThemeToDocument(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* التخزين المحلي غير متاح — تبقى السمة سارية لهذه الجلسة */
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('تعذّر تحديث مستمع السمة:', error);
    }
  }
}

export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * يُطبَّق الصنف على `<html>` فور تحميل الوحدة حتى لا يرى المستخدم وميضاً
 * بالسمة الخطأ قبل أول رسم (نفس ما كان يفعله main.tsx سابقاً).
 */
export function initTheme(): void {
  applyThemeToDocument(getTheme());
}

export interface ThemeController {
  theme: ThemeName;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: ThemeName) => void;
}

export function useTheme(): ThemeController {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as ThemeName);

  // مزامنة الصنف على <html> مع القيمة الحالية (تحديث نظام خارجي من تأثير،
  // لا setState داخل تأثير).
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const toggle = useCallback(() => toggleTheme(), []);
  const change = useCallback((next: ThemeName) => setTheme(next), []);

  return { theme, isDark: theme === 'dark', toggleTheme: toggle, setTheme: change };
}
