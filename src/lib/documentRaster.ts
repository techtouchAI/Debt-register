import { buildPrintDocument } from './print';

/**
 * تصوير مستند HTML إلى صورة (canvas) بمحرّك العرض نفسه.
 *
 * لماذا لا نكتفي بـ html2canvas؟ لأنه لا يرسم النص كالنص: يقرأ صناديق
 * السطور من الشجرة ثم **يحسب** خط الأساس لكل خط بمقياس خاص به
 * (`parseMetrics` في html2canvas يقيس داخل عنصر بـ `line-height: normal`
 * ثم يضيف 2 بكسل ثابتة). فحين يختلف ارتفاع السطر المعلن عن الارتفاع الطبيعي
 * للخط — وهو حال خط Cairo المدمج (≈ 1.6em لكل حجم) — ينزل النص في الصورة
 * عن موضعه الحقيقي بمقدار يتغيّر مع كل نمط سطر. القياس الفعلي على فاتورة:
 * كل سطر نص في ملف المستند أدنى بنحو 4–13 بكسل عما في وثيقة الطباعة،
 * والفارق يتراكم حتى ≈ 5 مم في نهاية المستند.
 *
 * الحل: يُبنى من مستند الإطار نفسه وثيقة SVG بـ `foreignObject`، فيرسمها
 * محرّك العرض **نفسه** الذي يرسم المعاينة والطباعة (نفس التخطيط، نفس خط
 * الأساس، نفس التفاف الأسطر). تُدمج الخطوط داخل الوثيقة كـ `data:` URL حتى
 * لا تحتاج إلى شبكة، وتُرمَّز الوثيقة بـ `base64` لا بـ `blob:` — فكروم
 * يعتبر صور SVG المعنونة بـ blob ملوّثة للـ canvas فيمنع قراءتها
 * (`getImageData`/`toDataURL`)، بينما `data:` تمرّ سليمة.
 *
 * ويبقى html2canvas مساراً احتياطياً: إن لم يدعم المحرّك رسم
 * `foreignObject` (متصفحات قديمة/WebView محدود) أو خرجت الصورة خالية، نعود
 * إليه تلقائياً فلا تتعطّل ميزة حفظ المستند على أي جهاز.
 */

/** عامل التصوير: 2 يجعل مخرجات المستند حادة عند تكبيرها للطباعة. */
export const RASTER_SCALE = 2;

/** كيف رُسمت الصفحة؟ يُستخدم في التشخيص والاختبارات. */
export type RasterEngine = 'native' | 'fallback';

export interface RasterizedDocument {
  canvas: HTMLCanvasElement;
  engine: RasterEngine;
}

export interface RasterizeOptions {
  /** عرض ورقة A4 بالبكسل (794 بكسل تقريباً). */
  widthPx: number;
  /** أقل ارتفاع لإطار القياس؛ يكبر تلقائياً إذا طال المحتوى. */
  minHeightPx: number;
  /** عامل التصوير (1 = مقاس الورقة، 2 = ضعفها لوضوح الطباعة). */
  scale?: number;
}

/** مهلة انتظار الخطوط والصور (مستند محلي: لا شبكة تنتظر). */
const ASSET_TIMEOUT_MS = 3000;

/**
 * تصوير مستند (جسمه فقط) إلى صورة.
 *
 * القياس والتصوير يجريان في إطار مستقل بمقاس الورقة نفسه، فلا تتسرّب أنماط
 * التطبيق إلى المستند ولا تتغيّر استعلامات الوسائط.
 */
export async function rasterizeDocument(bodyHtml: string, options: RasterizeOptions): Promise<RasterizedDocument> {
  const scale = options.scale ?? RASTER_SCALE;
  const frame = createMeasurementFrame(options.widthPx, options.minHeightPx);

  try {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error('تعذّر تجهيز مستند الطباعة');
    frameDocument.open();
    frameDocument.write(buildPrintDocument('', bodyHtml));
    frameDocument.close();

    await waitForFrameReady(frame, frameDocument);
    await waitForFrameFonts(frameDocument);
    await waitForImages(frameDocument.body);

    // ارتفاع التصوير = ارتفاع الورقة نفسها لا ارتفاع إطار القياس. ورقة
    // المستند (`.doc .page`) هي المرجع ولها ارتفاع A4 أدنى 297 مم.
    const measuredHeight = measureSheetHeight(frameDocument);
    const heightPx = measuredHeight > 0 ? Math.ceil(measuredHeight) : options.minHeightPx;
    if (heightPx > frame.clientHeight) frame.style.height = `${heightPx}px`;

    try {
      const canvas = await renderWithNativeEngine(frameDocument, options.widthPx, heightPx, scale);
      if (hasVisibleInk(canvas)) return { canvas, engine: 'native' };
      console.warn('الرسم الأصلي أعاد صورة خالية — نعود إلى html2canvas');
    } catch (error) {
      console.warn('تعذّر الرسم الأصلي للمستند — نعود إلى html2canvas:', error);
    }

    return { canvas: await renderWithHtml2Canvas(frameDocument, options.widthPx, heightPx, scale), engine: 'fallback' };
  } finally {
    frame.remove();
  }
}

/**
 * ارتفاع الورقة بالبكسل من صندوق الورقة (`.doc .page`)، وصفر إن تعذّر قياسه
 * فيُستعمل ارتفاع الإطار. (`minHeightPx` يخصّ الإطار لا الورقة.)
 */
function measureSheetHeight(frameDocument: Document): number {
  // لا `instanceof HTMLElement`: عناصر الإطار تنتمي إلى عالم (realm) آخر
  // فيفشل الفحص صامتاً ونقع على ارتفاع الإطار بدل ارتفاع الورقة.
  const sheet = (frameDocument.querySelector('.doc .page') ?? frameDocument.querySelector('.doc')) as HTMLElement | null;
  const height = sheet?.getBoundingClientRect().height ?? 0;
  if (height > 0) return height;
  return frameDocument.documentElement.scrollHeight;
}

/* ------------------------------------------------------------------ *
 * المحرّك الأصلي: وثيقة SVG بمستند XHTML داخلها
 * ------------------------------------------------------------------ */

async function renderWithNativeEngine(
  frameDocument: Document,
  widthPx: number,
  heightPx: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const styleText = await inlineStylesheetAssets(collectStyleText(frameDocument));
  const bodyMarkup = new XMLSerializer().serializeToString(frameDocument.body);
  const svg = buildSvgDocument(styleText, bodyMarkup, widthPx, heightPx);

  const image = new Image();
  image.decoding = 'sync';
  await loadImage(image, `data:image/svg+xml;base64,${toBase64(svg)}`);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPx * scale);
  canvas.height = Math.round(heightPx * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('تعذّر تجهيز لوحة التصوير');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * وثيقة SVG تحوي مستند XHTML كاملاً داخل `foreignObject`.
 *
 * الحاوية تحمل ما كان يحمله `html`/`body` في مستند الإطار (الاتجاه والخلفية
 * والعرض) لأن الوسمين لا وجود لهما داخل SVG.
 *
 * (مُصدَّرة أيضاً لأنها الوحدة النقية من المحرّك: تُختبر بلا متصفح.)
 */
export function buildSvgDocument(styleText: string, bodyMarkup: string, widthPx: number, heightPx: number): string {
  const wrapperStyle = `direction:rtl;width:${widthPx}px;min-height:${heightPx}px;background:#fff;margin:0;padding:0`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">` +
    `<foreignObject x="0" y="0" width="${widthPx}" height="${heightPx}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">` +
    `<style>${styleText}</style>${bodyMarkup}` +
    '</div></foreignObject></svg>'
  );
}

/** كل نصوص الأنماط في مستند الإطار (قواعد الخط المدمج + أنماط المستند). */
function collectStyleText(frameDocument: Document): string {
  return Array.from(frameDocument.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

/**
 * دمج ملفات الخطوط داخل الأنماط كـ `data:` URL.
 *
 * وثيقة SVG المعنونة بـ `data:` لا قاعدة لها تُحلّ بها العناوين النسبية،
 * ولذلك تُحوَّل كل عناوين `url(...)` إلى `data:` (وتُخزَّن مؤقتاً فلا تُقرأ
 * مرتين). وإن تعذّر الجلب (ملف مفقود مثلاً) يبقى العنوان كما هو مع تحويله
 * إلى مطلق، فلا يتعطّل التصوير.
 *
 * (مُصدَّرة أيضاً لأنها الوحدة النقية من المحرّك: تُختبر بلا متصفح.)
 */
export async function inlineStylesheetAssets(styleText: string): Promise<string> {
  const urls = new Set(Array.from(styleText.matchAll(/url\((['"]?)([^'")]+)\1\)/g)).map((match) => match[2]));
  if (urls.size === 0) return styleText;

  const replacements = await Promise.all(
    Array.from(urls).map(async (url) => [url, await inlineAsset(url)] as const)
  );
  const css = replacements.reduce((accumulator, [url, dataUrl]) => accumulator.split(url).join(dataUrl), styleText);
  // وثيقة الصورة لا تصل إلى موارد خارجية: تحذير تشخيصي إن بقي عنوان غير مدمج
  // (ينزل التصوير حينها إلى خطوط البديل فيختلف عن المعاينة).
  if (/url\(\s*['"]?(?!data:)/.test(css)) {
    console.warn('بعض أصول المستند لم تُدمج في وثيقة التصوير — قد تختلف الخطوط في الملف.');
  }
  return css;
}

const assetCache = new Map<string, Promise<string>>();

function inlineAsset(url: string): Promise<string> {
  const cached = assetCache.get(url);
  if (cached) return cached;
  const pending = fetchAsDataUrl(url);
  assetCache.set(url, pending);
  return pending;
}

async function fetchAsDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  let absolute: string;
  try {
    absolute = new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
  try {
    const response = await fetch(absolute);
    if (!response.ok) return absolute;
    const mimeType = response.headers.get('content-type') || 'font/woff2';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${mimeType};base64,${toBase64(bytes)}`;
  } catch {
    return absolute;
  }
}

/* ------------------------------------------------------------------ *
 * المحرّك الاحتياطي: html2canvas
 * ------------------------------------------------------------------ */

async function renderWithHtml2Canvas(
  frameDocument: Document,
  widthPx: number,
  heightPx: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas');
  const target = frameDocument.querySelector('.doc') ?? frameDocument.body;
  return html2canvas(target as HTMLElement, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    // مستند النسخة: نفس مقاس الورقة حتى لا تتغيّر استعلامات الوسائط
    windowWidth: widthPx,
    windowHeight: heightPx
  });
}

/* ------------------------------------------------------------------ *
 * أدوات القياس والتحقق
 * ------------------------------------------------------------------ */

function createMeasurementFrame(widthPx: number, heightPx: number): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-12000px';
  frame.style.top = '0';
  frame.style.width = `${widthPx}px`;
  frame.style.height = `${heightPx}px`;
  frame.style.border = '0';
  document.body.appendChild(frame);
  return frame;
}

async function waitForFrameReady(frame: HTMLIFrameElement, frameDocument: Document): Promise<void> {
  await new Promise<void>((resolve) => {
    if (frameDocument.readyState === 'complete') return resolve();
    frame.addEventListener('load', () => resolve(), { once: true });
    window.setTimeout(resolve, ASSET_TIMEOUT_MS);
  });
}

/** انتظار جاهزية خطوط مستند الإطار (خط Cairo المدمج). */
async function waitForFrameFonts(frameDocument: Document): Promise<void> {
  try {
    const fonts = frameDocument.fonts;
    if (!fonts?.ready) return;
    await Promise.race([
      fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, ASSET_TIMEOUT_MS))
    ]);
  } catch {
    /* الخطوط غير حرجة — نتابع بالبدائل */
  }
}

async function waitForImages(root: HTMLElement, timeoutMs = ASSET_TIMEOUT_MS): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return;
  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          })
      )
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
}

function loadImage(image: HTMLImageElement, src: string, timeoutMs = ASSET_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('انتهت مهلة رسم وثيقة الصفحة')), timeoutMs);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('تعذّر رسم وثيقة الصفحة'));
    };
    image.src = src;
  });
}

/**
 * هل في الصورة حبر مرئي؟ تُقاس على نسخة مصغّرة (200 بكسل عرضاً) فلا تُقرأ
 * ملايين البكسلات، وتكشف الحالة الخطرة: محرّك يرسم `foreignObject` فارغاً.
 */
function hasVisibleInk(canvas: HTMLCanvasElement): boolean {
  const probeWidth = 200;
  const probeHeight = Math.max(1, Math.round((probeWidth * canvas.height) / canvas.width));
  const probe = document.createElement('canvas');
  probe.width = probeWidth;
  probe.height = probeHeight;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return true;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, probeWidth, probeHeight);
  context.drawImage(canvas, 0, 0, probeWidth, probeHeight);
  try {
    const { data } = context.getImageData(0, 0, probeWidth, probeHeight);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return true;
    }
    return false;
  } catch {
    // تعذّرت القراءة (canvas ملوّث) ⇒ نعتبرها فاشلة ونتابع بالمحرّك الاحتياطي
    return false;
  }
}

/** ترميز نص UTF-8 إلى base64 على دفعات (النصوص الطويلة تكسر `String.fromCharCode`). */
function toBase64(text: string | Uint8Array): string {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
