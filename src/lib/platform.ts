/**
 * تعريفات موحّدة للجسور الأصلية (Capacitor على أندرويد، Electron على ويندوز).
 *
 * وجود الأنواع في مكان واحد يمنع تكرار التحويلات غير الآمنة (as any) في
 * كل ملف ويمنح تحققاً حقيقياً من الأنواع عند استدعاء الإضافات.
 */

export interface LocalNotificationRequest {
  title: string;
  body: string;
  id: number;
  schedule?: { at: Date };
}

export interface LocalNotificationsPlugin {
  schedule(options: { notifications: LocalNotificationRequest[] }): Promise<unknown>;
}

export interface FilesystemPlugin {
  writeFile(options: { path: string; data: string; directory: string; recursive: boolean }): Promise<unknown>;
}

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    LocalNotifications?: LocalNotificationsPlugin;
    Filesystem?: FilesystemPlugin;
  };
}

export interface ElectronSaveResult {
  success?: boolean;
  cancelled?: boolean;
  path?: string;
  error?: string;
}

/** نتيجة طباعة مستند عبر نافذة Electron المخفية. */
export interface ElectronPrintResult {
  success?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface ElectronFileResult {
  success?: boolean;
  cancelled?: boolean;
  path?: string;
  error?: string;
}

export interface ElectronAPI {
  saveBackup?: (fileName: string, data: string) => Promise<ElectronSaveResult>;
  /** حفظ ملف عام (PDF/JSON/...) عبر صندوق حفظ أصلي — data بصيغة base64 */
  saveFile?: (fileName: string, base64Data: string, mimeType: string) => Promise<ElectronFileResult>;
  showNotification?: (title: string, body: string) => Promise<unknown>;
  /**
   * طباعة مستند HTML عبر `webContents.print` في العملية الرئيسية.
   * Electron لا ينفّذ `window.print` إطلاقاً، فهذا هو المسار الصحيح للطباعة
   * على ويندوز (حوار الطباعة الأصلي + احترام `@page` داخل المستند).
   */
  printDocument?: (html: string, title?: string) => Promise<ElectronPrintResult>;
  appInfo?: () => Promise<{ version: string; platform: string; isElectron: boolean }>;
  isElectron?: boolean;
}

/**
 * واجهات Tauri العامة (`app.withGlobalTauri`). النواة فقط تظهر هنا؛
 * صندوق الحفظ والملفات يُستوردان من إضافاتهما في `tauriShell.ts`.
 */
export interface TauriDialogFilter {
  name: string;
  extensions: string[];
}

export interface TauriGlobal {
  dialog?: {
    save(options?: { title?: string; defaultPath?: string; filters?: TauriDialogFilter[] }): Promise<string | null>;
  };
  fs?: {
    writeFile(path: string, data: Uint8Array): Promise<void>;
  };
  path?: {
    downloadDir(): Promise<string>;
    join(...paths: string[]): Promise<string>;
  };
  window?: {
    getCurrentWindow(): { close(): Promise<void> };
  };
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    electronAPI?: ElectronAPI;
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.Capacitor;
}

export function getElectronAPI(): ElectronAPI | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

/** هل نعمل داخل غلاف Tauri (ويندوز/لينكس)؟ */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/** واجهات Tauri العامة إن كانت متاحة. */
export function getTauri(): TauriGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__TAURI__;
}

/** هل نعمل داخل غلاف سطح مكتب (Electron أو Tauri)؟ */
export function isDesktopShell(): boolean {
  return Boolean(getElectronAPI()) || isTauri();
}

export function isNativePlatform(): boolean {
  const capacitor = getCapacitor();
  try {
    return Boolean(capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}
