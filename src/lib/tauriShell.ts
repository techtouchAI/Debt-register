/**
 * جسور Tauri 2 الرسمية.
 *
 * `withGlobalTauri` يعرض نواة `@tauri-apps/api` فقط على `window.__TAURI__`.
 * إضافتا صندوق الحفظ والملفات ليستا ضمن تلك النواة، لذلك تُستوردان ديناميكياً
 * عند الحاجة ولا تُستدعيان في Electron أو أندرويد.
 */

export interface TauriSaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface TauriSaveApi {
  save(options?: TauriSaveDialogOptions): Promise<string | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  suggestedPath?(fileName: string): Promise<string>;
}

export type TauriSaveOutcome =
  | { ok: true; path: string }
  | { ok: false; cancelled?: boolean; error: string };

/** يحفظ عبر صندوق الحوار ثم يكتب البايتات. مسار التنزيلات اختياري. */
export async function saveWithTauriApi(
  fileName: string,
  bytes: Uint8Array,
  typeLabel: string,
  api: TauriSaveApi
): Promise<TauriSaveOutcome> {
  let defaultPath = fileName;
  if (api.suggestedPath) {
    try {
      const suggested = await api.suggestedPath(fileName);
      if (suggested) defaultPath = suggested;
    } catch {
      defaultPath = fileName;
    }
  }
  const extension = (fileName.split('.').pop() || '').toLowerCase();
  const target = await api.save({
    title: 'حفظ الملف',
    defaultPath,
    filters: extension ? [{ name: typeLabel, extensions: [extension] }] : undefined
  });
  if (!target) return { ok: false, cancelled: true, error: 'CANCELLED' };
  await api.writeFile(target, bytes);
  return { ok: true, path: target };
}

export async function loadTauriSaveApi(): Promise<TauriSaveApi> {
  const [{ save }, { writeFile }, pathApi] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path').catch(() => null)
  ]);
  return {
    save,
    writeFile,
    suggestedPath: pathApi ? async (name) => pathApi.join(await pathApi.downloadDir(), name) : undefined
  };
}

export async function closeTauriWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

export async function tauriNotificationAllowed(): Promise<boolean> {
  const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
  return isPermissionGranted();
}

export async function requestTauriNotificationPermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

/** إشعار واحد عبر الإضافة. لا يمرّ على Notification في المتصفح حتى لا يتكرر. */
export async function sendTauriNotification(title: string, body: string): Promise<boolean> {
  const { isPermissionGranted, sendNotification } = await import('@tauri-apps/plugin-notification');
  if (!(await isPermissionGranted())) return false;
  sendNotification({ title, body });
  return true;
}
