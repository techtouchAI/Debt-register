/**
 * هندسة الورق — مصدر واحد للحقيقة بين المعاينة والطباعة وملف PDF.
 *
 * العلّة التي يحلّها هذا الملف: كان كل مسار يرسم المستند بعرض مختلف:
 *  - المعاينة: إطار بعرض الحاوية (≈ 760 بكسل) وحشوة 16 بكسل.
 *  - الطباعة: إطار مخفي مقاسه 0×0، فينهار التخطيط (عرض الجدول بكسل واحد)
 *    وتختلف الأعمدة والأسطر عن المعاينة تماماً.
 *  - PDF: حاوية بعرض 794 بكسل وحشوة 24 بكسل، ثم تُمدَّد الصورة على ورقة A4
 *    كاملةً بلا هوامش، فيكبر المحتوى عن الطباعة وتضيق الأعمدة الرقمية.
 *
 * الحل: تعريف **ورقة** واحدة (عرض/ارتفاع/هامش) تُرسم بها المستندات في
 * المسارات الثلاثة، فالمحتوى يُخطَّط دائماً داخل صندوق محتوى واحد بالملّيمتر
 * (A4: 190×277 مم) — ومن ثمّ تتطابق الأعمدة والالتفافات والفواصل حرفياً.
 *
 * كل الحسابات هنا دوال نقية بلا DOM، فتُختبَر مباشرة.
 */

/** أنواع المستندات المدعومة في الحفظ/الطباعة. */
export type PdfFormat = 'a4';

export const MM_PER_INCH = 25.4;
/** كثافة CSS القياسية: 1in = 96px (تستخدمها كل المتصفحات في تخطيط mm/cm). */
export const CSS_DPI = 96;

export function mmToPx(mm: number): number {
  return (mm * CSS_DPI) / MM_PER_INCH;
}

export interface SheetGeometry {
  /** عرض الورقة (مم) = عرض منطقة الرسم في مسار PDF. */
  widthMm: number;
  /** ارتفاع الورقة (مم). */
  heightMm: number;
  /** الهامش الداخلي للورقة (مم) — وهو هوامش الورقة المطبوعة أيضاً. */
  marginMm: number;
}

/** ورقة A4: 210×297 مم بهامش 10 مم (نفس `@page` في CSS). */
export const A4_SHEET: SheetGeometry = { widthMm: 210, heightMm: 297, marginMm: 10 };

export function sheetFor(_format: PdfFormat = 'a4'): SheetGeometry {
  return A4_SHEET;
}

/** عرض منطقة رسم الورقة بالبكسل (نحوّل إليه المستند قبل التصوير). */
export function sheetRenderWidthPx(format: PdfFormat): number {
  return Math.round(mmToPx(sheetFor(format).widthMm));
}

/**
 * أقصى ارتفاع يُعدّ «ورقة واحدة» في A4 بالبكسل.
 * `min-height: 297mm` يجعل الورقة 1122.5 بكسل، والتصوير يقرّب لأعلى.
 */
export const A4_SINGLE_PAGE_MAX_PX = Math.ceil(mmToPx(A4_SHEET.heightMm as number));

/** ارتفاع منطقة المحتوى في ورقة A4 (297 − 20 = 277 مم) بالبكسل. */
export const A4_CONTENT_HEIGHT_PX = mmToPx((A4_SHEET.heightMm as number) - A4_SHEET.marginMm * 2);

/** هامش الورقة بالبكسل (نقلم به هوامش الورقة عند تقسيم الصفحات). */
export const A4_MARGIN_PX = mmToPx(A4_SHEET.marginMm);

/** صفحة PDF: من أين تُقتطع الصورة (بكسل) وأين تُرسم على الورقة (مم). */
export interface PdfPagePlan {
  sourceLeftPx: number;
  sourceTopPx: number;
  sourceWidthPx: number;
  sourceHeightPx: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** دالة تُخبر هل صفّ الصورة (بالبكسل) خالٍ تماماً — تُستخدم لتفادي قطع سطر. */
export type BlankRowProbe = (yPx: number) => boolean;

/** خيارات تخطيط الصفحات: عامل تصوير الصورة ومسطرة الصفوف الفارغة. */
export interface PagePlanOptions {
  /**
   * عامل التصوير المستخدم في html2canvas (بكسل الصورة لكل بكسل CSS).
   * الخطأ في تمريره يجعل حدود الصفحات تُحسب بوحدة خاطئة، فتنقسم ورقة
   * واحدة إلى صفحتين أو ثلاث.
   */
  scale?: number;
  isBlankRow?: BlankRowProbe;
}

/** منطقة المحتوى المرسوم فعلاً داخل الصورة (بالبكسل) — لتفادي رسم الفراغ. */
export interface InkBounds {
  leftPx: number;
  topPx: number;
  rightPx: number;
  bottomPx: number;
}

/** أقصى مسافة بحث صعوداً عن صف فارغ (12 مم) قبل قبول القطع على الحدّ. */
const BLANK_ROW_SEARCH_PX = mmToPx(12);
/** ألا يقلّ ما يُستغل من الصفحة عن 60% قبل تفضيل القطع عند صف فارغ. */
const MIN_PAGE_FILL_RATIO = 0.6;
/** ذيل أصغر من 3 مم يُضمّ إلى الصفحة السابقة بدل إنشاء صفحة شبه فارغة. */
const TAIL_MERGE_PX = mmToPx(3);

/**
 * تخطيط صفحات A4 لصورة ورقة واحدة.
 *
 * الحالات:
 *  - الورقة في حدود صفحة واحدة (المعتاد): تُرسم كما هي على كامل الورقة،
 *    فالهوامش هي حشوة الورقة نفسها — مطابقة تماماً للطباعة.
 *  - الورقة أطول: تُقصّ حشوة الورقة أولاً، ثم يُقسَّم المحتوى إلى صفحات
 *    بارتفاع منطقة المحتوى (277 مم)، ويُرسم كل جزء داخل هامش 10 مم، فلا
 *    تختفي الهوامش في الصفحات التالية. ويُبحث عن صف فارغ قريب من حدّ
 *    الصفحة حتى لا يُشطر سطر جدول بين صفحتين.
 */
export function planA4Pages(
  canvasWidthPx: number,
  canvasHeightPx: number,
  options: PagePlanOptions = {}
): PdfPagePlan[] {
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) return [];
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const isBlankRow = options.isBlankRow;
  const mmPerPx = A4_SHEET.widthMm / canvasWidthPx;
  const contentPagePx = A4_CONTENT_HEIGHT_PX * scale;
  const marginPx = A4_MARGIN_PX * scale;
  const singlePageMaxPx = A4_SINGLE_PAGE_MAX_PX * scale;
  const blankRowSearchPx = BLANK_ROW_SEARCH_PX * scale;
  const tailMergePx = TAIL_MERGE_PX * scale;

  if (canvasHeightPx <= singlePageMaxPx) {
    return [
      {
        sourceLeftPx: 0,
        sourceTopPx: 0,
        sourceWidthPx: canvasWidthPx,
        sourceHeightPx: canvasHeightPx,
        xMm: 0,
        yMm: 0,
        widthMm: A4_SHEET.widthMm,
        heightMm: canvasHeightPx * mmPerPx
      }
    ];
  }

  const contentLeft = Math.round(marginPx);
  const contentWidth = Math.round(canvasWidthPx - marginPx * 2);
  const contentTop = Math.round(marginPx);
  const contentBottom = Math.max(contentTop + 1, Math.round(canvasHeightPx - marginPx));
  const contentHeight = contentBottom - contentTop;

  const pages: PdfPagePlan[] = [];
  let offset = 0;
  while (offset < contentHeight) {
    let height = Math.min(contentPagePx, contentHeight - offset);

    // ذيل صغير (أقل من 3 مم) لا يستحق صفحة مستقلة
    if (contentHeight - offset - height <= tailMergePx) {
      height = contentHeight - offset;
    } else if (isBlankRow) {
      // لا نشطر سطر جدول: نصعد إلى أقرب صف فارغ قبل الحدّ
      const target = contentTop + offset + height;
      const limit = Math.max(contentTop + offset + height * MIN_PAGE_FILL_RATIO, target - blankRowSearchPx);
      for (let y = Math.floor(target); y >= Math.ceil(limit); y -= 1) {
        if (isBlankRow(y)) {
          height = y - (contentTop + offset);
          break;
        }
      }
    }

    if (height <= 0) break;
    pages.push({
      sourceLeftPx: contentLeft,
      sourceTopPx: contentTop + offset,
      sourceWidthPx: contentWidth,
      sourceHeightPx: Math.round(height),
      xMm: A4_SHEET.marginMm,
      yMm: A4_SHEET.marginMm,
      widthMm: (contentWidth * A4_SHEET.widthMm) / canvasWidthPx,
      heightMm: height * mmPerPx
    });
    offset += height;
  }
  return pages;
}
