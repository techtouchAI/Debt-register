import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getElectronAPI, getTauri, isTauri } from './platform';
import { sendSystemNotification } from './notify';
import { loadTauriSaveApi, saveWithTauriApi, type TauriSaveApi } from './tauriShell';

/**
 * خدمة حفظ الملفات الموحّدة (نسخ احتياطية، مستندات، تقارير).
 *
 * المشكلة السابقة: الحفظ كان يعتمد على `window.Capacitor.Plugins` القديمة ثم
 * يسقط إلى تنزيل المتصفح (`<a download>`) الذي لا يفعل شيئاً داخل WebView
 * أندرويد — فيضغط المستخدم زر الحفظ/التخزين ولا يحدث شيء إطلاقاً.
 *
 * السلوك لكل منصة (الغاية واحدة: المستخدم يختار/يعرف مكان الملف دائماً):
 *  - أندرويد: كتابة الملف عبر Filesystem الرسمية (مجلد التطبيق داخل
 *    المستندات، ثم بدائل آمنة)، وبعدها فتح نافذة المشاركة الأصلية ليحفظ
 *    المستخدم الملف في التنزيلات أو يرسله واتساب/إيميل، مع إشعار نظام يوضح
 *    مكان الملف. هذا هو السلوك المعتمد لأندرويد 10+ (Scoped Storage).
 *  - ويندوز (Electron): صندوق حفظ أصلي عبر العملية الرئيسية.
 *  - ويندوز/لينكس (Tauri): صندوق حفظ أصلي عبر إضافتي dialog و fs.
 *  - المتصفح: تنزيل عادي عبر Blob.
 */

export interface SaveFileInput {
  fileName: string;
  mimeType: string;
  /** نص (للبيانات النصية) أو Blob (للملفات الثنائية كالمستندات) */
  data: string | Blob;
  /** للملفات النصية فقط — الثنائية تُحوَّل تلقائياً إلى base64 */
  encoding?: 'utf8';
  /** مجلد فرعي داخل مجلد التطبيق */
  subDir?: string;
  /** فتح نافذة المشاركة على أندرويد بعد الحفظ (افتراضي: true لملفات المستخدم) */
  shareAfterSave?: boolean;
  /** عنوان يظهر في نافذة المشاركة */
  shareTitle?: string;
}

export interface SaveFileResult {
  ok: boolean;
  /** أين حُفظ الملف */
  via: 'native-documents' | 'native-cache-share' | 'electron' | 'tauri' | 'browser' | 'none';
  /** مسار/رابط الملف عند توفره */
  path?: string;
  error?: string;
}

/** اسم مجلد التطبيق (المستندات في أندرويد، التنزيلات في ويندوز). */
export const APP_FOLDER = 'إدارة المكتب';

/** وصف عربي لنوع الملف في صناديق الحفظ (بدل PDF/JSON). */
export function fileTypeLabel(fileName: string): string {
  const extension = (fileName.split('.').pop() || '').toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'مستند';
    case 'json':
      return 'ملف نسخة احتياطية';
    case 'csv':
      return 'جدول بيانات';
    default:
      return 'ملف';
  }
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // تحويل دفعات لتفادي تجاوز حد المكدس مع الملفات الكبيرة
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function downloadInBrowser(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // التأجيل يمنع إلغاء التنزيل في بعض المتصفحات
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function toBlob(input: SaveFileInput): Blob {
  if (typeof input.data !== 'string') return input.data;
  return new Blob([input.data], { type: input.mimeType });
}

/**
 * Tauri: صندوق حفظ أصلي (المسار المختار يُضاف تلقائياً لنطاق الكتابة المسموح)
 * ثم كتابة الملف. يُعيد null إن لم تكن الإضافات متاحة (فيسقط للمسار التالي).
 */
async function tauriSaveApi(): Promise<TauriSaveApi> {
  const globalApi = getTauri();
  if (globalApi?.dialog?.save && globalApi.fs?.writeFile) {
    return {
      save: (options) => globalApi.dialog!.save(options),
      writeFile: (filePath, data) => globalApi.fs!.writeFile(filePath, data),
      suggestedPath: globalApi.path
        ? async (name) => globalApi.path!.join(await globalApi.path!.downloadDir(), name)
        : undefined
    };
  }
  return loadTauriSaveApi();
}

async function saveWithTauri(input: SaveFileInput): Promise<SaveFileResult | null> {
  const bytes = new Uint8Array(await toBlob(input).arrayBuffer());
  const saved = await saveWithTauriApi(input.fileName, bytes, fileTypeLabel(input.fileName), await tauriSaveApi());
  if (!saved.ok) return { ok: false, via: 'none', error: saved.error };
  return { ok: true, via: 'tauri', path: saved.path };
}

/**
 * حفظ الملف على المنصة الحالية. لا يرمي استثناءً — يُعيد نتيجة صريحة
 * ليتمكن المستدعي من إظهار رسالة مناسبة للمستخدم.
 */
export async function saveFile(input: SaveFileInput): Promise<SaveFileResult> {
  const subDir = input.subDir ? `${APP_FOLDER}/${input.subDir}` : APP_FOLDER;
  const relativePath = `${subDir}/${input.fileName}`;

  // ---------- 1) أندرويد أصلي ----------
  if (isNative()) {
    const isText = typeof input.data === 'string';
    const base64Data = isText ? undefined : await blobToBase64(input.data as Blob).catch(() => null);
    if (!isText && base64Data === null) {
      return { ok: false, via: 'none', error: 'تعذّر تجهيز الملف للحفظ' };
    }

    // أ) محاولة الحفظ في مجلد المستندات العام (يصل إليه مدير الملفات)
    try {
      await Filesystem.requestPermissions().catch(() => undefined);
      await Filesystem.writeFile({
        path: relativePath,
        data: isText ? (input.data as string) : (base64Data as string),
        directory: Directory.Documents,
        encoding: isText ? Encoding.UTF8 : undefined,
        recursive: true
      });
      const uri = await Filesystem.getUri({ path: relativePath, directory: Directory.Documents }).catch(() => null);

      if (input.shareAfterSave !== false && uri?.uri) {
        await Share.share({ title: input.shareTitle || input.fileName, url: uri.uri }).catch(() => undefined);
      }
      await sendSystemNotification('تم حفظ الملف', `${input.fileName} — المستندات/${subDir}`);
      return { ok: true, via: 'native-documents', path: `المستندات/${relativePath}` };
    } catch (error) {
      console.warn('تعذّر الحفظ في المستندات، سأستخدم المشاركة المباشرة:', error);
    }

    // ب) البديل المضمون: ملف مؤقت + نافذة مشاركة النظام (أندرويد 10+)
    try {
      const cachePath = `${input.fileName}`;
      await Filesystem.writeFile({
        path: cachePath,
        data: isText ? (input.data as string) : (base64Data as string),
        directory: Directory.Cache,
        encoding: isText ? Encoding.UTF8 : undefined,
        recursive: true
      });
      const uri = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
      await Share.share({
        title: input.shareTitle || input.fileName,
        text: input.shareTitle || input.fileName,
        url: uri.uri
      });
      return { ok: true, via: 'native-cache-share', path: input.fileName };
    } catch (error) {
      console.warn('تعذّر حفظ الملف عبر المشاركة:', error);
      return { ok: false, via: 'none', error: 'تعذّر حفظ الملف على الجهاز' };
    }
  }

  // ---------- 2) ويندوز (Electron): صندوق حفظ أصلي ----------
  try {
    const electronAPI = getElectronAPI();
    if (electronAPI?.saveFile) {
      const blob = toBlob(input);
      const base64 = await blobToBase64(blob);
      const result = await electronAPI.saveFile(input.fileName, base64, input.mimeType);
      if (result?.success) {
        return { ok: true, via: 'electron', path: result.path };
      }
      if (result?.cancelled) {
        return { ok: false, via: 'none', error: 'CANCELLED' };
      }
      // فشل الحفظ الأصلي — نسقط إلى تنزيل المتصفح بدل إظهار خطأ
      console.warn('تعذّر الحفظ عبر غلاف ويندوز، سأستخدم التنزيل العادي:', result?.error);
    }
  } catch (error) {
    console.warn('تعذّر الحفظ عبر غلاف ويندوز:', error);
  }

  // ---------- 3) Tauri (ويندوز/لينكس): صندوق حفظ أصلي ----------
  if (isTauri()) {
    try {
      const result = await saveWithTauri(input);
      if (result) return result;
    } catch (error) {
      console.warn('تعذّر الحفظ عبر غلاف سطح المكتب:', error);
      return { ok: false, via: 'none', error: 'تعذّر حفظ الملف' };
    }
  }

  // ---------- 4) المتصفح ----------
  try {
    downloadInBrowser(input.fileName, toBlob(input));
    return { ok: true, via: 'browser' };
  } catch (error) {
    console.warn('تعذّر تنزيل الملف:', error);
    return { ok: false, via: 'none', error: 'تعذّر تنزيل الملف' };
  }
}

/** وصف عربي لمكان حفظ الملف بعد نجاح الحفظ (لرسائل النجاح). */
export function describeSavedLocation(result: SaveFileResult, fileName: string): string {
  switch (result.via) {
    case 'native-documents':
      return `${fileName} — حُفظ في ${result.path ?? 'المستندات'}`;
    case 'native-cache-share':
      return `${fileName} — اختر مكان الحفظ أو التطبيق من نافذة المشاركة`;
    case 'electron':
    case 'tauri':
      return `${fileName} — حُفظ في المكان الذي اخترته`;
    case 'browser':
      return `${fileName} — في مجلد التنزيلات`;
    default:
      return fileName;
  }
}
