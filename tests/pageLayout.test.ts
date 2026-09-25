import { describe, expect, it } from 'vitest';
import { A4_CONTENT_HEIGHT_PX, A4_MARGIN_PX, A4_SHEET, mmToPx, planA4Pages, sheetFor, sheetRenderWidthPx } from '@/lib/pageLayout';

describe('هندسة ورقة المستند القياسية', () => {
  it('يعتمد A4 فقط بعرض 210 وارتفاع 297 مم', () => {
    expect(A4_SHEET).toEqual({ widthMm: 210, heightMm: 297, marginMm: 10 });
    expect(sheetFor()).toEqual(A4_SHEET);
    expect(sheetRenderWidthPx('a4')).toBe(794);
    expect(A4_CONTENT_HEIGHT_PX).toBeCloseTo(mmToPx(277), 3);
  });

  it('يرسم الورقة القصيرة كاملة بهوامشها', () => {
    const pages = planA4Pages(1588, 2246, { scale: 2 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ sourceLeftPx: 0, sourceTopPx: 0, xMm: 0, yMm: 0, widthMm: 210 });
  });

  it('يقسم المحتوى الطويل إلى صفحات داخل هوامش A4', () => {
    const height = Math.round(mmToPx(500) * 2);
    const pages = planA4Pages(1588, height, { scale: 2, isBlankRow: (row) => row % 40 === 0 });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.xMm).toBe(A4_SHEET.marginMm);
      expect(page.yMm).toBe(A4_SHEET.marginMm);
      expect(page.widthMm).toBeCloseTo(190, 1);
    }
  });

  it('لا ينشئ خطة للمدخلات غير الصالحة', () => {
    expect(planA4Pages(0, 100)).toEqual([]);
    expect(planA4Pages(100, 0)).toEqual([]);
    expect(A4_MARGIN_PX).toBeGreaterThan(0);
  });
});
