import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSvgDocument, inlineStylesheetAssets } from '@/lib/documentRaster';

/**
 * محرّك تصوير المستند: الجزء النقي منه (بناء وثيقة SVG ودمج أصول الأنماط) —
 * يُختبر بلا متصفح، أما التصوير نفسه فيُتحقق منه في اختبار المتصفح.
 *
 * العطل الذي يمنعه هذا المحرّك: `html2canvas` يحسب خط الأساس بنفسه
 * (‏`parseMetrics` يقيس على `line-height: normal` ثم يضيف 2 بكسل)، وخط
 * Cairo المدمج ارتفاعه الطبيعي ≈ 1.6em، فينزل النص في ملف المستند عن موضعه
 * في المعاينة والطباعة. الرسم بمحرّك العرض عبر `foreignObject` يلغي ذلك.
 */

// ملاحظة: يُبنى الردّ من بايتات لا من Blob الخاص بـ jsdom (لا يفهمه Response)
const fontResponse = (body: string, type = 'font/woff2') =>
  new Response(new TextEncoder().encode(body), { status: 200, headers: { 'content-type': type } });

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('وثيقة SVG للتصوير', () => {
  it('تحوي مستند XHTML داخل foreignObject بمقاسات الورقة ونفس الاتجاه والخلفية', () => {
    const svg = buildSvgDocument('body { color: #000; }', '<div class="doc"><p>الرصيد السابق</p></div>', 794, 1123);

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123">');
    expect(svg).toContain('<foreignObject x="0" y="0" width="794" height="1123">');
    // الحاوية تحمل ما كان يحمله html/body في مستند الإطار
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).toContain('direction:rtl');
    expect(svg).toContain('width:794px');
    expect(svg).toContain('background:#fff');
    // الأنماط والمحتوى داخل الوثيقة نفسها (لا موارد خارجية)
    expect(svg).toContain('<style>body { color: #000; }</style>');
    expect(svg).toContain('الرصيد السابق');
  });

  it('يبني SVG بعرض ورقة قياسية دون افتراضات محتوى', () => {
    const svg = buildSvgDocument('', '<div class="doc"></div>', 794, 1123);
    expect(svg).toContain('width="794" height="1123"');
    expect(svg).toContain('width:794px');
  });
});

describe('دمج أصول الأنماط داخل وثيقة التصوير', () => {
  it('يحوّل ملف الخط إلى data: URL — وثيقة الصورة لا تصل إلى موارد خارجية', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fontResponse('FONT-BYTES'))
    );

    const css = await inlineStylesheetAssets(
      "@font-face { font-family: 'Cairo Variable'; src: url(/assets/cairo-arabic-wght-normal.woff2) format('woff2'); }"
    );

    expect(css).toContain('src: url(data:font/woff2;base64,');
    expect(css).not.toContain('/assets/cairo-arabic-wght-normal.woff2');
    // المحتوى نفسه مُرمَّزاً (FONT-BYTES)
    expect(css).toContain(Buffer.from('FONT-BYTES').toString('base64'));
  });

  it('يترك العنوان المطلق كما هو إذا تعذّر الجلب (لا يتعطّل التصوير)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );

    const css = await inlineStylesheetAssets("src: url('cairo.woff2') format('woff2');");
    expect(css).toContain('http');
    expect(css).toContain('cairo.woff2');
  });

  it('لا يقرأ الأصل مرتين (تخزين مؤقت بين الاستدعاءات)', async () => {
    const fetchMock = vi.fn(async () => fontResponse('FONT-BYTES'));
    vi.stubGlobal('fetch', fetchMock);
    const css = "src: url(/assets/shared-font.woff2), url('/assets/shared-font.woff2');";

    await inlineStylesheetAssets(css);
    await inlineStylesheetAssets(css);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('يمرّر الأنماط كما هي إذا لم تحوِ أصولاً', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const css = '.doc { color: #333; }';
    expect(await inlineStylesheetAssets(css)).toBe(css);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
