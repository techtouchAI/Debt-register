import { escapeHtml, formatDate, formatLocalDateInput, roundMoney, toFiniteNumber } from './utils';
import { officeNameFontSize } from './officeName';
import { formatDocumentNumber, paymentMethodLabel, saleTypeLabel } from './labels';
import { getElectronAPI, isNativePlatform } from './platform';
import { A4_SHEET, sheetFor, sheetRenderWidthPx, type PdfFormat } from './pageLayout';
import { openDocumentPreview } from './documentPreview';
import type { Customer, Invoice, InvoiceItem, OfficeSettings, Payment, Purchase, PurchaseItem } from '@/types';

/**
 * مستندات الطباعة والمعاينة وملفات PDF.
 *
 * مبدأ التصميم: **ورقة واحدة** (`.doc .page`) تُرسم بها المستندات الثلاثة
 * — المعاينة والطباعة وتوليد PDF — بنفس عرض الورقة وارتفاعها وهوامشها
 * (انظر `pageLayout.ts`). فالمحتوى يُخطَّط دائماً داخل صندوق محتوى واحد
 * بالملّيمتر (A4: 190×277 مم)، ومن ثمّ تتطابق الأعمدة والالتفافات والفواصل
 * في المخرجات الثلاثة بدل ثلاثة تخطيطات متباينة:
 *  - المعاينة: الورقة كاملة داخل إطار، مُحجَّمة لتناسب عرض الحاوية.
 *  - الطباعة: إطار **بمقاس الورقة** (794×1123 بكسل) خارج الشاشة مع
 *    `@page { size: A4; margin: 10mm }` — كان الإطار 0×0 فينهار التخطيط.
 *  - PDF: تُصوَّر الورقة نفسها بعرضها الحقيقي وتُرسم بهوامشها (بلا تكبير).
 *
 * الطباعة تتم عبر iframe (لا `window.open`): النوافذ المنبثقة محظورة في
 * WebView أندرويد ومرفوضة في Electron (setWindowOpenHandler يرفضها) فكانت
 * الطباعة لا تعمل إطلاقاً هناك. ولا نُعلن النجاح إلا بدليل: ننتظر حدث
 * `beforeprint` من الإطار — فبعض البيئات (WebView، أو إطار مُقيَّد بحاجب
 * sandbox) تُهمل `print()` بصمت بلا استثناء، فلا يظهر للمستخدم شيء أبداً.
 *
 * كل قيمة ديناميكية تُهرَّب عبر escapeHtml لأن أسماء الزبائن والمواد
 * والملاحظات تُدخل يدوياً وقد تصل من ملف نسخة احتياطية مستورد؛ إدراجها
 * خاماً كان يسمح بتنفيذ شيفرة (XSS).
 */

/* ------------------------------------------------------------------ *
 * ورقة الأنماط المشتركة للمستندات
 *
 * قواعد منع خروج المحتوى (تُطبَّق على الفاتورة والوصل والكشف):
 *  - الجداول بعرض ثابت (table-layout: fixed) مع أعمدة بنِسَب محسوبة.
 *  - الأرقام والتواريخ والمبالغ: سطر واحد لا ينكسر أبداً (nowrap + ltr).
 *  - النصوص العربية: التفاف عند حدود الكلمات فقط (word-break: normal)،
 *    والكسر داخل الكلمة مسموح فقط للسلاسل الطويلة بلا مسافات حتى لا
 *    تخرج عن حد الخلية (overflow-wrap: break-word).
 *  - صفوف الجدول لا تنشطر بين صفحتين (break-inside: avoid).
 *  - أزواج (التسمية: القيمة) القصيرة لا تنفصل عن بعضها.
  - ارتفاع السطر لا يقلّ عن الارتفاع الطبيعي للخط المدمج (Cairo ≈ 1.6em):
    كان عنوان الترويسة بارتفاع 1.4em فيفيض الحبر عن صندوق السطر، ويختلف
    موضعه بين محرّك الطباعة ومحرّك التصوير (فرق ≈ 3 مم في أعلى الصفحة).
 * ------------------------------------------------------------------ */

const DOCUMENT_CSS = `
html, body { margin: 0; padding: 0; background: #fff; }
.doc { font-family: 'Cairo Variable', 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; color: #111827; direction: rtl; line-height: 1.7; }
.doc * { box-sizing: border-box; }
.doc h1, .doc h2, .doc h3, .doc p { margin: 0; }

/* ---- الورقة: مصدر واحد للتخطيط في المعاينة والطباعة و PDF ----
   المقاسات بالملّيمتر لا بالبكسل، فيرسم المتصفح المستند نفسه في كل مسار
   داخل صندوق محتوى واحد (190×277 مم في A4). */
.doc .page { width: ${A4_SHEET.widthMm}mm; min-height: ${A4_SHEET.heightMm}mm; padding: ${A4_SHEET.marginMm}mm; margin: 0 auto; background: #fff; }

.doc-header { text-align: center; border-bottom: 2px solid #8f7048; padding-bottom: 12px; margin-bottom: 14px; }
.doc-header h1 { color: #8f7048; font-size: 22px; line-height: 1.6; overflow-wrap: anywhere; word-break: normal; white-space: normal; }
.doc-header h1.office-name, .doc.receipt h2.office-name { display: block; overflow: visible; -webkit-line-clamp: unset; line-clamp: unset; }
.doc-header .sub { color: #6b7280; font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
.doc-header img { max-height: 60px; max-width: 180px; margin-top: 8px; object-fit: contain; }
.doc-meta { display: flex; flex-wrap: wrap; gap: 6px 24px; justify-content: space-between; margin-bottom: 14px; font-size: 13px; }
.doc-meta .col { min-width: 0; }
.doc-meta .pair { white-space: nowrap; }
.doc-meta .pair .v { font-weight: 700; }
.doc-meta .wrap { white-space: normal; word-break: normal; overflow-wrap: anywhere; }
.doc table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 14px; font-size: 13px; }
.doc table.grid th, .doc table.grid td { border: 1px solid #d1d5db; padding: 7px 8px; vertical-align: top; }
.doc table.grid thead th { background: #f0fdf4; font-size: 12.5px; }
.doc table.grid thead { display: table-header-group; }
.doc table.grid tbody tr { break-inside: avoid; page-break-inside: avoid; }
.doc table.grid td.name { word-break: normal; overflow-wrap: anywhere; }
.doc .num { white-space: nowrap; direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }
.doc .c { text-align: center; }
.doc .l { text-align: left; }
.doc .totals { text-align: left; border-top: 2px solid #8f7048; padding-top: 10px; font-size: 13px; }
.doc .totals p { white-space: nowrap; }
.doc .totals .grand { font-size: 17px; font-weight: 800; color: #8f7048; }
.doc .notes { margin-top: 10px; font-size: 12px; color: #4b5563; word-break: normal; overflow-wrap: anywhere; }
.doc .doc-footer { text-align: center; margin-top: 20px; padding-top: 10px; border-top: 1px dashed #d1d5db; color: #6b7280; font-size: 12px; }
.doc .section-title { font-size: 14px; font-weight: 800; margin: 0 0 6px; }
.doc .balance { font-size: 15px; font-weight: 800; white-space: nowrap; }

/* ---- وصل حراري 80مم: ورقته 80مم أيضاً حتى يتطابق ما يُرى مع ما يُطبع ---- */
.doc.receipt .page { width: ${sheetFor('receipt80').widthMm}mm; min-height: 0; padding: ${sheetFor('receipt80').marginMm}mm 2.5mm; font-size: 13px; }
.doc.receipt h2 { font-size: 17px; }
.doc.receipt hr { border: 0; border-top: 1px dashed #9ca3af; margin: 10px 0; }
.doc.receipt .lines { text-align: right; line-height: 2; }
.doc.receipt .lines p { word-break: normal; overflow-wrap: anywhere; }
.doc.receipt .amount { font-size: 18px; font-weight: 800; color: #8f7048; white-space: nowrap; }
.doc.receipt .muted { color: #6b7280; font-size: 12px; }

/* ---- هيكل المعاينة (لا يُستخدم في الطباعة ولا في PDF) ----
   خلفية رمادية وورقة كاملة في الوسط: المستخدم يرى الورقة كما ستُطبع.
   و--doc-zoom تحدّده نافذة المعاينة ليظهر عرض الورقة كاملاً على الشاشات
   الضيقة. تُطبَّق على الورقة وحدها، ومسار الطباعة لا يستخدم .doc-view. */
.doc-view { margin: 0; background: #eef0f3; padding: 12px 8px; }
.doc-view .page { zoom: var(--doc-zoom, 1); box-shadow: 0 1px 4px rgba(15, 23, 42, 0.18); }

@media print {
  body { margin: 0; background: #fff; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* هيكل المعاينة (خلفية رمادية وحشوة) لا يُطبع إطلاقاً — فقط الورقة ومحتواها */
  .doc-view { background: #fff !important; padding: 0 !important; }
  .doc { width: auto; }
  /* الطباعة تُبرز المحتوى بلا ورق إضافي: هوامش الورقة الأربعة تتولاها @page */
  .doc .page { width: auto; min-height: 0; padding: 0; zoom: 1; box-shadow: none; margin: 0; }
  /* الوصل الحراري يحتفظ بعرض ورقته (80مم) وحشوتها عند الطباعة */
  .doc.receipt .page { width: ${sheetFor('receipt80').widthMm}mm; padding: ${sheetFor('receipt80').marginMm}mm 2.5mm; margin: 0 auto; }
}
@page { size: A4; margin: ${A4_SHEET.marginMm}mm; }
`;

/**
 * ترويسة اسم المكتب.
 * الاسم يُطبع كاملاً دائماً؛ وإذا طال نصغّر الخط تدريجياً بدل أن يخرج عن
 * حدود الصفحة (يعمل مع الطباعة و PDF لأن الاثنين يستخدمان القالب نفسه).
 */
function officeNameHeading(settings: OfficeSettings, tag: 'h1' | 'h2' = 'h1'): string {
  const name = settings.officeName || '';
  const size = officeNameFontSize(name);
  const extra = tag === 'h1' ? '' : '; font-size:' + Math.max(14, size - 5) + 'px';
  return `<${tag} class="office-name doc-office-name" data-office-name="${escapeHtml(name)}" style="font-size:${size}px${extra}">${escapeHtml(name)}</${tag}>`;
}

export type DocumentKind = 'invoice' | 'receipt' | 'statement';

export interface BuiltDocument {
  kind: DocumentKind;
  title: string;
  /** نص الجسم فقط (يُستخدم داخل المعاينة/الطباعة/PDF) */
  bodyHtml: string;
}

/**
 * قواعد الخط المدمج في التطبيق (@font-face) بعناوين مطلقة.
 *
 * مستند الطباعة يُكتب داخل إطار مستقل لا يرث خطوط الصفحة، فكان يُطبع بخط
 * النظام (يختلف بين ويندوز وأندرويد). ننسخ قواعد الخط من أوراق الأنماط
 * المحمّلة ونحوّل عناوينها النسبية إلى مطلقة، فتخرج الفاتورة المطبوعة بنفس
 * خط التطبيق والمعاينة وملف المستند على كل المنصات — دون إنترنت.
 */
function collectFontFaceCss(): string {
  if (typeof document === 'undefined') return '';
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // ورقة أنماط من مصدر آخر لا يُسمح بقراءتها
    }
    const base = sheet.href || document.baseURI;
    for (const rule of Array.from(cssRules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const text = rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote: string, url: string) => {
        if (/^(data:|blob:)/i.test(url)) return match;
        try {
          return `url(${quote}${new URL(url, base).href}${quote})`;
        } catch {
          return match;
        }
      });
      rules.push(text);
    }
  }
  return rules.join('\n');
}

/** خيارات بناء وثيقة العرض. */
export interface PrintDocumentOptions {
  /**
   * `preview`: إضافة هيكل المعاينة (خلفية رمادية وورقة مظلَّلة في الوسط)
   * — لا يُستخدم في مسار الطباعة إطلاقاً، لأن الخلفية الرمادية كانت
   * تُطبع فعلاً فتظهر الورقة رمادية وتبدو الهوامش مختلفة.
   * `print`: الورقة وحدها على أبيض (الافتراضي).
   */
  view?: 'print' | 'preview';
  /**
   * عرض الحاوية المتاح بالبكسل (نافذة المعاينة): تُحجَّم ورقة A4 لتناسبه
   * فلا يحتاج المستخدم إلى تمرير أفقي لرؤية عرض الورقة كاملاً.
   */
  fitWidthPx?: number;
}

/** أقصى تصغير مسموح به في المعاينة (ورقة A4 = 794 بكسل). */
const PREVIEW_HORIZONTAL_PADDING_PX = 24;

/** وثيقة HTML كاملة وجاهزة (لـ iframe المعاينة/الطباعة). */
export function buildPrintDocument(title: string, bodyHtml: string, options: PrintDocumentOptions = {}): string {
  const isPreview = options.view === 'preview';
  const available = options.fitWidthPx;
  // عروض الورق بالبكسل: A4 (794) أو الوصل الحراري (302) — التصغير بأيّهما أوسع
  const widestSheetPx = Math.max(sheetRenderWidthPx('a4'), sheetRenderWidthPx('receipt80'));
  const zoom =
    isPreview && typeof available === 'number' && available > 0
      ? Math.min(1, available / (widestSheetPx + PREVIEW_HORIZONTAL_PADDING_PX))
      : 1;
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${collectFontFaceCss()}${DOCUMENT_CSS}</style>
</head>
<body class="${isPreview ? 'doc-view' : ''}" style="--doc-zoom:${zoom.toFixed(3)};">${bodyHtml}</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * الطباعة عبر iframe بمقاس الورقة — تعمل في المتصفح وElectron
 * ------------------------------------------------------------------ */

/**
 * نتيجة محاولة الطباعة:
 *  - `printed`: فُتح حوار الطباعة (بدليل من الإطار).
 *  - `unsupported`: هذه البيئة لا تنفّذ `window.print` (WebView أندرويد/iOS).
 *  - `blocked`: المتصفح منع الحوار (نافذة/إطار مُقيَّد بحاجب sandbox).
 */
export type PrintOutcome = 'printed' | 'unsupported' | 'blocked';

/**
 * هل يمكن فتح حوار طباعة في هذه البيئة؟
 * - سطح المكتب (Electron): عبر جسر `webContents.print` — فـ Electron لا
 *   ينفّذ `window.print` إطلاقاً.
 * - المتصفح: `window.print`.
 * - WebView أندرويد وiOS: لا حوار طباعة أصلاً.
 */
export function systemPrintAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (getElectronAPI()?.printDocument) return true;
  if (typeof window.print !== 'function') return false;
  return !isNativePlatform();
}

/** مهلة انتظار دليل الطباعة (beforeprint) قبل اعتبار الحوار محجوباً. */
const PRINT_EVIDENCE_TIMEOUT_MS = 700;

function waitForIframeReady(iframe: HTMLIFrameElement, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = window.setTimeout(done, timeoutMs);
    // الكتابة عبر document.write تكتمل فوراً في معظم الحالات: لا داعي لانتظار حدث load
    try {
      if (iframe.contentDocument?.readyState === 'complete') {
        window.clearTimeout(timer);
        // مهلة قصيرة لتحميل الصور (الشعار) قبل الطباعة
        window.setTimeout(done, 250);
        return;
      }
    } catch {
      /* الوصول ممنوع؟ نكمل بانتظار load */
    }
    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        // مهلة قصيرة لتحميل الصور (الشعار) قبل الطباعة
        window.setTimeout(done, 250);
      },
      { once: true }
    );
  });
}

/** انتظار جاهزية خطوط المستند (Cairo) قبل الطباعة أو التصوير. */
async function waitForDocumentFonts(targetWindow: Window, timeoutMs = 1500): Promise<void> {
  try {
    const fonts = targetWindow.document?.fonts;
    if (!fonts?.ready) return;
    await Promise.race([fonts.ready, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
  } catch {
    /* الخطوط غير حرجة — نتابع بالبدائل */
  }
}

/**
 * طباعة مستند HTML. لا تُعيد `printed` إلا إذا وصل حدث `beforeprint` من
 * الإطار: بعض البيئات تُهمل `print()` بصمت (بلا استثناء ولا حوار)، وحينها
 * يعرض المستدعي وثيقة المعاينة بدل أن لا يرى المستخدم شيئاً.
 */
export async function printHtmlDocument(title: string, bodyHtml: string): Promise<PrintOutcome> {
  if (!systemPrintAvailable()) return 'unsupported';

  // سطح المكتب: الطباعة عبر العملية الرئيسية (window.print لا يعمل في Electron)
  const electronPrint = getElectronAPI()?.printDocument;
  if (electronPrint) {
    try {
      const result = await electronPrint(buildPrintDocument(title, bodyHtml), title);
      if (result?.success) return 'printed';
      if (result?.cancelled) return 'blocked';
      console.warn('تعذّرت الطباعة من سطح المكتب:', result?.error);
      return 'blocked';
    } catch (error) {
      console.warn('تعذّرت الطباعة من سطح المكتب:', error);
      return 'blocked';
    }
  }

  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = document.createElement('iframe');
    iframe.setAttribute('title', title);
    // **بمقاس الورقة**: كان الإطار 0×0 فينهار التخطيط داخل نافذة الطباعة
    // (عرض الجدول بكسل واحد والأرقام مكدّسة). العرض هنا = 210مم بالبكسل.
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = `${sheetRenderWidthPx('a4')}px`;
    iframe.style.height = `${Math.round((A4_SHEET.heightMm as number) * (sheetRenderWidthPx('a4') / A4_SHEET.widthMm))}px`;
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return 'blocked';
    }

    doc.open();
    doc.write(buildPrintDocument(title, bodyHtml));
    doc.close();

    await waitForIframeReady(iframe);
    const frameWindow = iframe.contentWindow;
    if (!frameWindow || typeof frameWindow.print !== 'function') {
      iframe.remove();
      return 'blocked';
    }
    await waitForDocumentFonts(frameWindow);

    // دليل الطباعة: يُرسل `beforeprint` (و`afterprint`) داخل الإطار عند
    // فتح الحوار فعلاً. لا نعتمد على عدم وقوع استثناء فقط.
    let evidence = false;
    const markPrinted = () => {
      evidence = true;
    };
    frameWindow.addEventListener('beforeprint', markPrinted);
    frameWindow.addEventListener('afterprint', markPrinted);

    frameWindow.focus();
    frameWindow.print();
    await new Promise((resolve) => window.setTimeout(resolve, PRINT_EVIDENCE_TIMEOUT_MS));
    frameWindow.removeEventListener('beforeprint', markPrinted);
    frameWindow.removeEventListener('afterprint', markPrinted);

    // إزالة متأخرة حتى لا يُجهَض حوار الطباعة في بعض المتصفحات
    const frameToRemove = iframe;
    window.setTimeout(() => frameToRemove.remove(), 2000);
    return evidence ? 'printed' : 'blocked';
  } catch (error) {
    console.warn('تعذّر الطباعة:', error);
    iframe?.remove();
    return 'blocked';
  }
}

/* ------------------------------------------------------------------ *
 * وثيقة موصوفة: تُبنى مرة وتُستخدم في المعاينة والطباعة والحفظ
 * ------------------------------------------------------------------ */

/**
 * وصف مستند جاهز: يحتوي كل ما تحتاجه المسارات الثلاثة معاً.
 * وجودها يمنع تكرار بناء نفس المستند في كل صفحة، ويمنع تباين اسم الملف
 * أو العنوان بين الطباعة والحفظ.
 */
export interface DocumentDescriptor {
  title: string;
  bodyHtml: string;
  fileNameBase: string;
  shareTitle: string;
  pdfFormat: PdfFormat;
}

/** رسالة توضيحية تُعرض داخل المعاينة عندما لا يمكن فتح حوار طباعة النظام. */
export const PRINT_FALLBACK_NOTICE: Record<Exclude<PrintOutcome, 'printed'>, string> = {
  unsupported:
    'لا يوجد حوار طباعة في هذا الجهاز (أندرويد/iPhone): التطبيق يعرض المستند هنا، واحفظه أو شاركه ثم اطبع الملف من أي تطبيق يعرض المستندات.',
  blocked:
    'منع المتصفح فتح حوار الطباعة في هذه النافذة. اضغط «حفظ كمستند» ثم اطبع الملف، أو افتح التطبيق في نافذة مستقلة.'
};

/**
 * طباعة وثيقة. إذا لم يُفتح حوار الطباعة (جهاز لا يدعمه، أو نافذة مُقيَّدة)
 * تُعرض الوثيقة في نافذة المعاينة مع رسالة توضّح البديل — فلا يبقى الضغط
 * على «طباعة» بلا أي أثر مرئي.
 */
export async function printDocument(document: DocumentDescriptor): Promise<PrintOutcome> {
  const outcome = await printHtmlDocument(document.title, document.bodyHtml);
  if (outcome !== 'printed') {
    openDocumentPreview({ ...document, notice: PRINT_FALLBACK_NOTICE[outcome] });
  }
  return outcome;
}


/* ------------------------------------------------------------------ *
 * قوالب المستندات
 * ------------------------------------------------------------------ */

export function buildInvoicePrintHtml(invoice: Invoice, items: InvoiceItem[], settings: OfficeSettings): string {
  const currency = escapeHtml(settings.currency || '');
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td class="c num">${index + 1}</td>
          <td class="name">${escapeHtml(item.materialName)}</td>
          <td class="c num">${escapeHtml(item.quantity)}</td>
          <td class="c num">${escapeHtml(item.unitPrice.toLocaleString('ar-IQ'))}</td>
          <td class="l num">${escapeHtml(item.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const statusText = invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة';
  // الدين القديم المحمول على الفاتورة: يُعرض سطراً مستقلاً ثم يُجمع في
  // «إجمالي المطلوب» — ولا يُضاف إلى «الإجمالي» حتى لا تحتسبه أرصدة
  // الزبائن والتقارير مرتين (دين الفواتير السابقة محفوظ على فواتيرها).
  const previousBalance = Math.max(0, toFiniteNumber(invoice.previousBalance));
  const totalDue = roundMoney(invoice.total + previousBalance);

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" />` : ''}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="pair">رقم الفاتورة: <span class="v num">${escapeHtml(formatDocumentNumber(invoice.invoiceNumber))}</span></p>
          <p class="wrap">الزبون: <strong>${escapeHtml(invoice.customerName)}</strong></p>
          <p class="pair">النوع: <span class="v">${saleTypeLabel(invoice.type)}</span></p>
        </div>
        <div class="col">
          <p class="pair">التاريخ: <span class="v">${escapeHtml(formatDate(invoice.date, true))}</span></p>
          <p class="pair">الحالة: <span class="v">${statusText}</span></p>
        </div>
      </div>

      <table class="grid">
        <colgroup>
          <col style="width:8%" />
          <col style="width:42%" />
          <col style="width:13%" />
          <col style="width:17%" />
          <col style="width:20%" />
        </colgroup>
        <thead>
          <tr><th class="c">#</th><th>المادة</th><th class="c">الكمية</th><th class="c">السعر</th><th class="l">الإجمالي</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="c" style="color:#6b7280;">لا توجد مواد</td></tr>'}</tbody>
      </table>

      <div class="totals">
        <p>المجموع: <span class="num">${escapeHtml(invoice.subtotal.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${invoice.discount > 0 ? `<p>الخصم: <span class="num">${escapeHtml(invoice.discount.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
        <p class="grand">الإجمالي: <span class="num">${escapeHtml(invoice.total.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${
          previousBalance > 0
            ? `<p>الرصيد السابق: <span class="num">${escapeHtml(previousBalance.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        <p class="grand">إجمالي المطلوب: <span class="num">${escapeHtml(totalDue.toLocaleString('ar-IQ'))}</span> ${currency}</p>`
            : ''
        }
        ${
          invoice.type === 'credit'
            ? `<p>المدفوع: <span class="num">${escapeHtml(invoice.paidAmount.toLocaleString('ar-IQ'))}</span> | المتبقي على هذه الفاتورة: <span class="num">${escapeHtml(invoice.remaining.toLocaleString('ar-IQ'))}</span></p>${
                previousBalance > 0
                  ? `<p class="notes">الرصيد السابق هو دين قديم على الزبون قبل هذه الفاتورة، ويُسدَّد معها في نفس الوصل.</p>`
                  : ''
              }`
            : ''
        }
      </div>

      ${invoice.notes ? `<p class="notes">ملاحظات: ${escapeHtml(invoice.notes)}</p>` : ''}
      ${settings.invoiceFooter ? `<div class="doc-footer">${escapeHtml(settings.invoiceFooter)}</div>` : ''}
    </div></div>`;
}

/** وصف فاتورة بيع: يُستخدم في المعاينة والطباعة والحفظ بلا تكرار. */
export function invoiceDocument(invoice: Invoice, items: InvoiceItem[], settings: OfficeSettings): DocumentDescriptor {
  const number = formatDocumentNumber(invoice.invoiceNumber);
  return {
    title: `فاتورة ${number}`,
    bodyHtml: buildInvoicePrintHtml(invoice, items, settings),
    fileNameBase: `فاتورة_${number}_${invoice.customerName}`,
    shareTitle: `فاتورة ${number}`,
    pdfFormat: 'a4'
  };
}

export function buildReceiptPrintHtml(payment: Payment, settings: OfficeSettings, remainingDebt?: number): string {
  const currency = escapeHtml(settings.currency || '');
  const methodText = paymentMethodLabel(payment.method);
  return `
    <div class="doc receipt"><div class="page" style="text-align:center;">
      ${officeNameHeading(settings, 'h2')}
      ${settings.phone ? `<p class="muted num">${escapeHtml(settings.phone)}</p>` : ''}
      <hr />
      <h3 style="font-size:15px;">وصل قبض</h3>
      <div class="lines">
        <p><strong>رقم الوصل:</strong> <span class="num">${escapeHtml(formatDocumentNumber(payment.receiptNumber))}</span></p>
        <p><strong>التاريخ:</strong> ${escapeHtml(formatDate(payment.date, true))}</p>
        <p><strong>الزبون:</strong> ${escapeHtml(payment.customerName)}</p>
        <p><strong>طريقة الدفع:</strong> ${methodText}</p>
      </div>
      <hr />
      <p class="amount">المبلغ: <span class="num">${escapeHtml(payment.amount.toLocaleString('ar-IQ'))}</span> ${currency}</p>
      ${remainingDebt !== undefined ? `<p>الدين المتبقي: <span class="num">${escapeHtml(remainingDebt.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
      ${payment.notes ? `<p class="muted">ملاحظات: ${escapeHtml(payment.notes)}</p>` : ''}
      <hr />
      <p class="muted">${escapeHtml(settings.invoiceFooter || 'شكراً لتعاملكم معنا')}</p>
    </div></div>`;
}

/** وصف وصل قبض: ورقته حرارية 80مم (معاينةً وطباعةً وملفاً). */
export function receiptDocument(payment: Payment, settings: OfficeSettings, remainingDebt?: number): DocumentDescriptor {
  const number = formatDocumentNumber(payment.receiptNumber);
  return {
    title: `وصل قبض ${number}`,
    bodyHtml: buildReceiptPrintHtml(payment, settings, remainingDebt),
    fileNameBase: `وصل_قبض_${number}_${payment.customerName}`,
    shareTitle: `وصل قبض ${number}`,
    pdfFormat: 'receipt80'
  };
}

export function buildCustomerStatementPrintHtml(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): string {
  const currency = escapeHtml(settings.currency || '');

  const invoiceRows = invoices
    .map(
      (invoice) => `
        <tr>
          <td class="name">${escapeHtml(formatDate(invoice.date))}</td>
          <td class="c num">${escapeHtml(formatDocumentNumber(invoice.invoiceNumber))}</td>
          <td class="c">${saleTypeLabel(invoice.type)}</td>
          <td class="l num">${escapeHtml(invoice.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const paymentRows = payments
    .map(
      (payment) => `
        <tr>
          <td class="name">${escapeHtml(formatDate(payment.date))}</td>
          <td class="c num">${escapeHtml(formatDocumentNumber(payment.receiptNumber))}</td>
          <td class="l num">${escapeHtml(payment.amount.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
        <h2 style="font-size:16px; margin-top:6px;">كشف حساب الزبون</h2>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="wrap">الزبون: <strong>${escapeHtml(customer.fullName)}</strong></p>
          <p class="pair">الهاتف: <span class="v num">${escapeHtml(customer.phone || '—')}</span></p>
        </div>
        <div class="col">
          <p class="wrap">العنوان: <strong>${escapeHtml(customer.address || '—')}</strong></p>
          <p class="balance" style="color:${totalDebt > 0 ? '#dc2626' : '#15803d'};">الرصيد المتبقي: <span class="num">${escapeHtml(totalDebt.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        </div>
      </div>

      <h3 class="section-title">الفواتير</h3>
      <table class="grid">
        <colgroup><col style="width:30%" /><col style="width:28%" /><col style="width:17%" /><col style="width:25%" /></colgroup>
        <thead><tr><th>التاريخ</th><th class="c">رقم الفاتورة</th><th class="c">النوع</th><th class="l">المبلغ</th></tr></thead>
        <tbody>${invoiceRows || '<tr><td colspan="4" class="c" style="color:#6b7280;">لا توجد فواتير</td></tr>'}</tbody>
      </table>

      <h3 class="section-title">التسديدات</h3>
      <table class="grid">
        <colgroup><col style="width:35%" /><col style="width:35%" /><col style="width:30%" /></colgroup>
        <thead><tr><th>التاريخ</th><th class="c">رقم الوصل</th><th class="l">المبلغ</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="3" class="c" style="color:#6b7280;">لا توجد تسديدات</td></tr>'}</tbody>
      </table>
    </div></div>`;
}

/** وصف كشف حساب الزبون. */
export function statementDocument(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: OfficeSettings,
  totalDebt: number
): DocumentDescriptor {
  return {
    title: `كشف حساب - ${customer.fullName}`,
    bodyHtml: buildCustomerStatementPrintHtml(customer, invoices, payments, settings, totalDebt),
    fileNameBase: `كشف_حساب_${customer.fullName}_${formatLocalDateInput()}`,
    shareTitle: `كشف حساب ${customer.fullName}`,
    pdfFormat: 'a4'
  };
}

export function buildPurchasePrintHtml(purchase: Purchase, items: PurchaseItem[], settings: OfficeSettings): string {
  const currency = escapeHtml(settings.currency || '');
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td class="c num">${index + 1}</td>
          <td class="name">${escapeHtml(item.materialName)}</td>
          <td class="c num">${escapeHtml(item.quantity)}</td>
          <td class="c num">${escapeHtml(item.purchasePrice.toLocaleString('ar-IQ'))}</td>
          <td class="l num">${escapeHtml(item.total.toLocaleString('ar-IQ'))}</td>
        </tr>`
    )
    .join('');

  const methodText = saleTypeLabel(purchase.paymentMethod);

  return `
    <div class="doc"><div class="page">
      <div class="doc-header">
        ${officeNameHeading(settings)}
        ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" />` : ''}
        <p class="sub">${escapeHtml(settings.address || '')}${settings.address && settings.phone ? ' | ' : ''}<span class="num">${escapeHtml(settings.phone || '')}</span></p>
        <h2 style="font-size:16px; margin-top:8px; color:#8f7048;">وصل شراء / إدخال مخزن</h2>
      </div>

      <div class="doc-meta">
        <div class="col">
          <p class="pair">رقم الوصل: <span class="v num">${escapeHtml(formatDocumentNumber(purchase.purchaseNumber))}</span></p>
          <p class="wrap">المورد: <strong>${escapeHtml(purchase.supplierName)}</strong></p>
          <p class="pair">طريقة الدفع: <span class="v">${methodText}</span></p>
        </div>
        <div class="col">
          <p class="pair">التاريخ: <span class="v">${escapeHtml(formatDate(purchase.date, true))}</span></p>
          <p class="pair">عدد المواد: <span class="v">${purchase.itemsCount}</span></p>
        </div>
      </div>

      <table class="grid">
        <colgroup>
          <col style="width:8%" />
          <col style="width:42%" />
          <col style="width:13%" />
          <col style="width:17%" />
          <col style="width:20%" />
        </colgroup>
        <thead>
          <tr><th class="c">#</th><th>المادة</th><th class="c">الكمية</th><th class="c">سعر الشراء</th><th class="l">الإجمالي</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="c" style="color:#6b7280;">لا توجد مواد</td></tr>'}</tbody>
      </table>

      <div class="totals">
        <p>المجموع: <span class="num">${escapeHtml(purchase.subtotal.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${purchase.discount > 0 ? `<p>الخصم: <span class="num">${escapeHtml(purchase.discount.toLocaleString('ar-IQ'))}</span> ${currency}</p>` : ''}
        <p class="grand">الإجمالي: <span class="num">${escapeHtml(purchase.total.toLocaleString('ar-IQ'))}</span> ${currency}</p>
        ${purchase.paymentMethod === 'credit' ? `<p>المدفوع: <span class="num">${escapeHtml(purchase.paidAmount.toLocaleString('ar-IQ'))}</span> | المتبقي على المكتب: <span class="num">${escapeHtml(purchase.remaining.toLocaleString('ar-IQ'))}</span></p>` : ''}
      </div>

      ${purchase.notes ? `<p class="notes">ملاحظات: ${escapeHtml(purchase.notes)}</p>` : ''}
      ${settings.invoiceFooter ? `<div class="doc-footer">${escapeHtml(settings.invoiceFooter)}</div>` : ''}
    </div></div>`;
}

/** وصف وصل شراء. */
export function purchaseDocument(purchase: Purchase, items: PurchaseItem[], settings: OfficeSettings): DocumentDescriptor {
  const number = formatDocumentNumber(purchase.purchaseNumber);
  return {
    title: `وصل شراء ${number}`,
    bodyHtml: buildPurchasePrintHtml(purchase, items, settings),
    fileNameBase: `وصل_شراء_${number}_${purchase.supplierName}`,
    shareTitle: `وصل شراء ${number}`,
    pdfFormat: 'a4'
  };
}
