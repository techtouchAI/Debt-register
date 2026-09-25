import { type DocumentDescriptor } from './print';
import {
  planA4Pages,
  sheetRenderWidthPx,
  A4_SHEET,
  type BlankRowProbe,
  type InkBounds,
  type PdfFormat,
  type PdfPagePlan
} from './pageLayout';
import { describeSavedLocation, saveFile } from './files';
import { sanitizeFileName } from './utils';
import { RASTER_SCALE, rasterizeDocument } from './documentRaster';

/**
 * توليد ملفات PDF من قوالب HTML نفسها المستخدمة في المعاينة والطباعة.
 *
 * لماذا الرسم من HTML بدل نص jsPDF المباشر؟
 * خط jsPDF الافتراضي (helvetica) لا يدعم العربية إطلاقاً — كان النص العربي
 * يظهر مفككاً ومقلوباً في الملفات السابقة. الرسم من HTML يعطي عربية سليمة
 * تماماً.
 *
 * والتصوير نفسه يتم بمحرّك العرض (وثيقة SVG بـ foreignObject، انظر
 * `documentRaster.ts`) لا بمحرّك حسابي، فخط الأساس والتخطيط مطابقان
 * لوثيقة الطباعة والمعاينة.
 *
 * وكيف يتطابق الملف مع المعاينة والطباعة؟ تُصوَّر **الورقة نفسها** بعرضها
 * الحقيقي (210مم = 794 بكسل) بلا تكبير ولا حشوة إضافية، ثم تُرسم بالملّيمتر
 * داخل ورقة A4 فالهوامش هي حشوة الورقة نفسها. وكانت العلّة
 * السابقة أن حاوية بعرض 794 بكسل وحشوة 24 بكسل تُمدَّد على ورقة A4 كاملةً،
 * فيكبر المحتوى بنحو 11% وتضيق الأعمدة الرقمية وتختفي الهوامش، وتبدو
 * الفاتورة المطبوعة مختلفة عن الملف.
 *
 * الحفظ يتم عبر خدمة الملفات الموحّدة: مشاركة/مستندات على أندرويد، صندوق
 * حفظ على ويندوز، تنزيل في المتصفح — بدل `doc.save` الذي لا يفعل شيئاً
 * داخل WebView.
 */

/**
 * مكتبة إنشاء المستند (jspdf) تُحمَّل عند أول حفظ مستند فقط، لا عند إقلاع
 * التطبيق — إقلاع أسرع بوضوح على هواتف أندرويد الضعيفة. الملفات محلية داخل
 * التطبيق فلا حاجة لإنترنت، ومحرّك التصوير في `documentRaster.ts`.
 */
async function loadJsPdf() {
  const { default: jsPDF } = await import('jspdf');
  return jsPDF;
}

/**
 * فاحص صفّ فارغ داخل الصورة: يُستخدم لئلا يُشطر سطر جدول بين صفحتين.
 * يُقرأ من بيانات الصورة مباشرة (صف واحد = شريط بسماكة بكسل واحد).
 */
function createBlankRowProbe(canvas: HTMLCanvasElement): BlankRowProbe {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return () => false;
  return (yPx: number): boolean => {
    const y = Math.round(yPx);
    if (y < 0 || y >= canvas.height) return false;
    try {
      const { data } = context.getImageData(0, y, canvas.width, 1);
      for (let i = 0; i < data.length; i += 4) {
        // أي بكسل غير أبيض (خلفية المستند بيضاء) = السطر مكتظ
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * ترميز صورة الصفحة: JPEG بجودة عالية.
 * PNG بلا فقدان يجعل ملف فاتورة واحدة ≈ 10 م.ب (ثقيل جداً للمشاركة على
 * أندرويد)، وJPEG بجودة 95 يعطي المظهر نفسه بجزء صغير من الحجم.
 */
const IMAGE_QUALITY = 0.95;

/**
 * حدود المحتوى المرسوم فعلاً (الفراغ الأبيض حوله لا يُصوَّر ولا يُرمَّز).
 * تُقرأ من بيانات الصورة بمسح الصفوف ثم الأعمدة داخل نطاق الصفوف المكتظة.
 */
function measureInkBounds(canvas: HTMLCanvasElement): InkBounds {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const empty: InkBounds = { leftPx: 0, topPx: 0, rightPx: canvas.width, bottomPx: canvas.height };
  if (!context) return empty;
  const isInk = (data: Uint8ClampedArray, index: number) =>
    data[index] < 250 || data[index + 1] < 250 || data[index + 2] < 250;

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    const { data } = context.getImageData(0, y, canvas.width, 1);
    let has = false;
    for (let i = 0; i < data.length; i += 4) {
      if (isInk(data, i)) {
        has = true;
        break;
      }
    }
    if (has) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (top === -1) return empty;

  let left = canvas.width;
  let right = 0;
  for (let y = top; y <= bottom; y += 1) {
    const { data } = context.getImageData(0, y, canvas.width, 1);
    for (let x = 0; x < canvas.width; x += 1) {
      if (!isInk(data, x * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return { leftPx: left, topPx: top, rightPx: right + 1, bottomPx: bottom + 1 };
}

interface PdfWriter {
  addImage: (...args: unknown[]) => void;
  addPage: () => void;
}

/**
 * يرسم جزءاً من صورة المستند على ورقة واحدة بمقاسات الملّيمتر المحسوبة.
 *
 * يُقصّ الرسم إلى حدود المحتوى (`ink`) مع الحفاظ على موضعه الأصلي على
 * الورقة: الفراغ الأبيض حول المحتوى لا يُصوَّر ولا يُرمَّز، فينخفض حجم
 * الملف بلا أي فرق مرئي أو تغيّر في المواضع.
 */
function drawPage(doc: PdfWriter, source: HTMLCanvasElement, plan: PdfPagePlan, ink: InkBounds, mmPerPx: number): boolean {
  const left = Math.max(Math.round(plan.sourceLeftPx), ink.leftPx);
  const top = Math.max(Math.round(plan.sourceTopPx), ink.topPx);
  const right = Math.min(Math.round(plan.sourceLeftPx + plan.sourceWidthPx), ink.rightPx);
  const bottom = Math.min(Math.round(plan.sourceTopPx + plan.sourceHeightPx), ink.bottomPx);
  if (right - left <= 0 || bottom - top <= 0) return false;

  const slice = document.createElement('canvas');
  slice.width = right - left;
  slice.height = bottom - top;
  const context = slice.getContext('2d');
  if (!context) throw new Error('تعذّر تجهيز صفحة المستند');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, slice.width, slice.height);
  context.drawImage(source, left, top, slice.width, slice.height, 0, 0, slice.width, slice.height);
  // الموضع على الورقة يُزاح بمقدار ما قُصّ من الأعلى/اليمين حتى لا يتحرك المحتوى
  doc.addImage(
    slice.toDataURL('image/jpeg', IMAGE_QUALITY),
    'JPEG',
    plan.xMm + (left - plan.sourceLeftPx) * mmPerPx,
    plan.yMm + (top - plan.sourceTopPx) * mmPerPx,
    slice.width * mmPerPx,
    slice.height * mmPerPx
  );
  return true;
}

/**
 * تصوير مستند إلى ملف PDF بنفس هندسة ورقته.
 */
async function renderHtmlToPdfBlob(bodyHtml: string, format: PdfFormat): Promise<Blob> {
  const renderWidthPx = sheetRenderWidthPx(format);
  const minHeightPx = Math.round(A4_SHEET.heightMm * (renderWidthPx / A4_SHEET.widthMm));
  const { canvas } = await rasterizeDocument(bodyHtml, { widthPx: renderWidthPx, minHeightPx, scale: RASTER_SCALE });
  const jsPDF = await loadJsPdf();
  const ink = measureInkBounds(canvas);


  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as unknown as PdfWriter;
  const pages = planA4Pages(canvas.width, canvas.height, {
    scale: RASTER_SCALE,
    isBlankRow: createBlankRowProbe(canvas)
  });
  if (pages.length === 0) throw new Error('لا يوجد محتوى في المستند');
  const mmPerPx = A4_SHEET.widthMm / canvas.width;
  let drawn = 0;
  pages.forEach((plan) => {
    // صفحة بلا محتوى (كلها فراغ) لا تُضاف أصلاً
    if (drawn > 0) doc.addPage();
    if (drawPage(doc, canvas, plan, ink, mmPerPx)) drawn += 1;
  });
  if (drawn === 0) throw new Error('لا يوجد محتوى في المستند');
  return (doc as unknown as { output: (kind: string) => Blob }).output('blob');
}

/** نتيجة حفظ مستند: اسم الملف ووصف عربي لمكانه (لرسالة النجاح). */
export interface SavedDocument {
  fileName: string;
  message: string;
}

/**
 * حفظ المستند عبر خدمة الملفات الموحّدة.
 * @returns null إذا ألغى المستخدم صندوق الحفظ (لا رسالة نجاح كاذبة).
 */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle: string): Promise<SavedDocument | null> {
  const safeName = sanitizeFileName(fileName, 'مستند') + '.pdf';
  const result = await saveFile({
    fileName: safeName,
    mimeType: 'application/pdf',
    data: blob,
    shareTitle
  });
  if (!result.ok) {
    if (result.error === 'CANCELLED') return null;
    throw new Error(result.error || 'تعذّر حفظ المستند');
  }
  return { fileName: safeName, message: describeSavedLocation(result, safeName) };
}

/** حفظ أي وثيقة موصوفة (فاتورة/وصل/كشف) كمستند PDF. */
export async function saveDocumentPdf(document: DocumentDescriptor): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(document.bodyHtml, document.pdfFormat);
  return savePdfBlob(blob, document.fileNameBase, document.shareTitle || document.title);
}

/**
 * توليد PDF من جسم مستند مبني مسبقاً.
 * يُستخدم في نافذة المعاينة (التي تعمل على جسم جاهز) وفي مسودات النماذج.
 */
export async function generatePdfFromBodyHtml(
  bodyHtml: string,
  fileName: string,
  shareTitle: string,
  format: PdfFormat = 'a4'
): Promise<SavedDocument | null> {
  const blob = await renderHtmlToPdfBlob(bodyHtml, format);
  return savePdfBlob(blob, fileName, shareTitle);
}
