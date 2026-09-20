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
  appInfo?: () => Promise<{ version: string; platform: string; isElectron: boolean }>;
  isElectron?: boolean;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    electronAPI?: ElectronAPI;
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

export function isNativePlatform(): boolean {
  const capacitor = getCapacitor();
  try {
    return Boolean(capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}
