import { describe, expect, it } from 'vitest';
import {
  A4_CONTENT_HEIGHT_PX,
  A4_MARGIN_PX,
  A4_SHEET,
  RECEIPT_MAX_HEIGHT_MM,
  RECEIPT_MIN_HEIGHT_MM,
  RECEIPT_SHEET,
  mmToPx,
  planA4Pages,
  planReceiptPage,
  sheetFor,
  sheetRenderWidthPx
} from '@/lib/pageLayout';

/**
 * هندسة الورق: الأساس الذي يجعل المعاينة والطباعة وملف PDF متطابقة.
 *
 * كانت العلّة أن كل مسار يرسم المستند بعرض مختلف (760 بكسل للمعاينة، إطار
 * 0×0 للطباعة، 794 بكسل بلا هوامش لملف PDF)، فتختلف الأعمدة والأسطر
 * والهوامش. الاختبارات هنا تثبّت مقاسات الورقة الواحدة وخطة صفحات PDF.
 */

describe('مقاسات الورق', () => {
  it('ورقة A4 هي 210×297 مم بهامش 10 مم، وعرضها 794 بكسل', () => {
    expect(A4_SHEET).toEqual({ widthMm: 210, heightMm: 297, marginMm: 10 });
    expect(sheetRenderWidthPx('a4')).toBe(794);
    expect(A4_MARGIN_PX).toBeCloseTo(37.795, 3);
    // منطقة المحتوى = 297 − 20 = 277 مم
    expect(A4_CONTENT_HEIGHT_PX).toBeCloseTo(mmToPx(277), 3);
  });

  it('ورقة الوصل الحراري 80 مم', () => {
    expect(sheetFor('receipt80')).toEqual(RECEIPT_SHEET);
    expect(RECEIPT_SHEET.widthMm).toBe(80);
    expect(sheetRenderWidthPx('receipt80')).toBe(302);
  });
});

describe('خطة صفحات A4', () => {
  it('الورقة في حدود صفحة واحدة تُرسم على الورقة كاملة بهوامشها', () => {
    // ورقة A4 مصوَّرة بعامل 2: 1588×2246 بكسل
    const pages = planA4Pages(1588, 2246, { scale: 2 });
    expect(pages).toHaveLength(1);
    const plan = pages[0];
    expect(plan.sourceLeftPx).toBe(0);
    expect(plan.sourceTopPx).toBe(0);
    expect(plan.sourceWidthPx).toBe(1588);
    expect(plan.xMm).toBe(0);
    expect(plan.yMm).toBe(0);
    expect(plan.widthMm).toBeCloseTo(210, 1);
    expect(plan.heightMm).toBeCloseTo(297, 1);
  });

  it('عامل التصوير يُحترم: الورقة الطويلة تنقسم إلى صفحتين لا ثلاث', () => {
    // ارتفاع 400 مم مصوَّر بعامل 2 = 3024 بكسل ⇒ داخل الهامش تبقى 380 مم
    const canvasWidth = 1588;
    const canvasHeight = Math.round(mmToPx(400) * 2);
    const pages = planA4Pages(canvasWidth, canvasHeight, { scale: 2, isBlankRow: () => true });
    // 380 مم محتوى / 277 مم لكل صفحة ⇒ صفحتان
    expect(pages).toHaveLength(2);
    // كل صفحة تُرسم داخل هامش 10 مم من أعلى وحافة منطقة المحتوى نفسها
    for (const plan of pages) {
      expect(plan.xMm).toBe(A4_SHEET.marginMm);
      expect(plan.yMm).toBe(A4_SHEET.marginMm);
      expect(plan.widthMm).toBeCloseTo(190, 1);
    }
    // لا فراغ مهدور: الصفحتان تغطيان كامل منطقة المحتوى
    const covered = pages.reduce((sum, plan) => sum + plan.sourceHeightPx, 0);
    expect(covered).toBeGreaterThanOrEqual(canvasHeight - A4_MARGIN_PX * 2 * 2 - 2);
    expect(covered).toBeLessThanOrEqual(canvasHeight - A4_MARGIN_PX * 2 * 2 + 2);
  });

  it('يقف عند صفّ فارغ حتى لا يُشطر سطر جدول بين صفحتين', () => {
    const canvasWidth = 1588;
    const canvasHeight = Math.round(mmToPx(500) * 2);
    // الصفوف الفارغة عند كل نهاية نطاق 40 بكسل، والحدّ الطبيعي للصفحة الأولى
    // يقع داخل سطر مكتظ ⇒ يجب أن يصعد إلى آخر صف فارغ قبل الحدّ
    const blankAt = (y: number) => y % 40 === 0;
    const pages = planA4Pages(canvasWidth, canvasHeight, { scale: 2, isBlankRow: blankAt });
    const firstEnd = pages[0].sourceTopPx + pages[0].sourceHeightPx;
    expect(blankAt(firstEnd)).toBe(true);
    // ولا ينزل عن 60% من الصفحة (لا يهدر الصفحة بحجة تفادي الشطر)
    expect(firstEnd).toBeGreaterThan(A4_CONTENT_HEIGHT_PX * 2 * 0.6);
  });

  it('الذيل الصغير يُضمّ إلى الصفحة السابقة بدل صفحة شبه فارغة', () => {
    const canvasWidth = 1588;
    // 277 مم محتوى + ذيل 1 مم ⇒ صفحة واحدة للمحتوى والذيل
    const canvasHeight = Math.round((mmToPx(277) + mmToPx(1) + A4_MARGIN_PX * 2) * 2);
    const pages = planA4Pages(canvasWidth, canvasHeight, { scale: 2 });
    expect(pages).toHaveLength(1);
  });

  it('لا خطط لمدخلات غير صالحة', () => {
    expect(planA4Pages(0, 100)).toEqual([]);
    expect(planA4Pages(100, 0)).toEqual([]);
    expect(planReceiptPage(0, 500)).toEqual([]);
  });
});

describe('خطة صفحة الوصل الحراري', () => {
  it('ارتفاع الورقة يتبع المحتوى مع حدّين أدنى وأقصى', () => {
    const short = planReceiptPage(604, 300)[0];
    expect(short.heightMm).toBe(RECEIPT_MIN_HEIGHT_MM);

    const normal = planReceiptPage(604, 900)[0];
    // 900 بكسل بعرض 604 ⇒ 121 مم تقريباً
    expect(normal.heightMm).toBeGreaterThan(100);
    expect(normal.heightMm).toBeLessThan(150);

    const huge = planReceiptPage(604, 90000)[0];
    expect(huge.heightMm).toBe(RECEIPT_MAX_HEIGHT_MM);
  });

  it('الوصل يُرسم بعرض ورقته كاملاً بلا هوامش إضافية', () => {
    const plan = planReceiptPage(604, 900)[0];
    expect(plan.xMm).toBe(0);
    expect(plan.yMm).toBe(0);
    expect(plan.widthMm).toBe(RECEIPT_SHEET.widthMm);
  });
});
