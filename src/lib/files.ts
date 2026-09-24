import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getElectronAPI } from './platform';
import { sendSystemNotification } from './notify';

/**
 * خدمة حفظ الملفات الموحّدة (نسخ احتياطية، PDF، تقارير).
 *
 * المشكلة السابقة: الحفظ كان يعتمد على `window.Capacitor.Plugins` القديمة ثم
 * يسقط إلى تنزيل المتصفح (`<a download>`) الذي لا يفعل شيئاً داخل WebView
 * أندرويد — فيضغط المستخدم زر الحفظ/التخزين ولا يحدث شيء إطلاقاً.
 *
 * التصميم الجديد لكل منصة:
 *  - أندرويد: كتابة الملف عبر Filesystem الرسمية (مجلد OfficeManager داخل
 *    المستندات، ثم بدائل آمنة)، وبعدها فتح نافذة المشاركة الأصلية ليحفظ
 *    المستخدم الملف في التنزيلات أو يرسله واتساب/إيميل، مع إشعار نظام يوضح
 *    مكان الملف. هذا هو السلوك المعتمد لأندرويد 10+ (Scoped Storage).
 *  - ويندوز (Electron): صندوق حفظ أصلي عبر العملية الرئيسية.
 *  - المتصفح: تنزيل عادي عبر Blob.
 */

export interface SaveFileInput {
  fileName: string;
  mimeType: string;
  /** نص (للبانات النصية كـ JSON) أو Blob (للملفات الثنائية كـ PDF) */
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
  via: 'native-documents' | 'native-cache-share' | 'electron' | 'browser' | 'none';
  /** مسار/رابط الملف عند توفره */
  path?: string;
  error?: string;
}

const APP_FOLDER = 'OfficeManager';

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
      await sendSystemNotification('تم حفظ الملف', `${input.fileName} — مجلد المستندات/${subDir}`);
      return { ok: true, via: 'native-documents', path: uri?.uri || `المستندات/${relativePath}` };
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
      return { ok: true, via: 'native-cache-share', path: uri.uri };
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
      console.warn('تعذّر الحفظ عبر Electron، سأستخدم التنزيل العادي:', result?.error);
    }
  } catch (error) {
    console.warn('تعذّر الحفظ عبر Electron:', error);
  }

  // ---------- 3) المتصفح ----------
  try {
    downloadInBrowser(input.fileName, toBlob(input));
    return { ok: true, via: 'browser' };
  } catch (error) {
    console.warn('تعذّر تنزيل الملف:', error);
    return { ok: false, via: 'none', error: 'تعذّر تنزيل الملف' };
  }
}
