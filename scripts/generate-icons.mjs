#!/usr/bin/env node
/**
 * توليد أيقونة التطبيق لكل الأنظمة من مصدر واحد (`resources/icon/*.svg`).
 *
 * التصميم: وصل بيع عاجي بحافة مسننة وأسطر عربية (محاذاة يمين) وختم برونزي
 * «تم التسديد» على أخضر مريمي — الفواتير والقبض والديون، بألوان هوية التطبيق.
 *
 * المصادر (تُعدَّل يدوياً):
 *   icon-background.svg  الخلفية: تدرّج أخضر مريمي يمتد حتى الحواف
 *   icon-foreground.svg  الرمز بخلفية شفافة (طبقة أمامية للأيقونة التكيفية)
 *   icon-small.svg       نسخة مبسّطة للأحجام ≤ 40 بكسل (أسطر أسمك، بلا ظلال)
 *
 * النواتج (مُولَّدة — لا تُعدَّل يدوياً؛ عدّل المصادر ثم نفّذ `npm run icons`):
 *   الويب/PWA   public/favicon.svg و favicon.ico و apple-touch-icon.png
 *               و pwa-192x192.png و pwa-512x512.png (any) و pwa-maskable-512x512.png
 *   ويندوز      resources/icon/app.ico (Electron) و desktop/src-tauri/icons/* (Tauri)
 *   أندرويد     resources/android/res/** : أيقونة تكيفية (خلفية متجهة + رمز + طبقة
 *               أحادية اللون للأيقونات ذات السمة)، أيقونة قديمة ودائرية، شاشة البدء
 *               resources/android/ic_stat_agri.xml : أيقونة الإشعارات
 *   تُنسخ موارد أندرويد إلى المشروع المولَّد عبر scripts/prepare-android.mjs.
 *
 * `npm run icons -- --check` يتحقق أن النواتج الملتزمة مطابقة للمصادر دون كتابة.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeIcns, encodeIco, encodePng, ICNS_TYPES, unpremultiply } from './icons/formats.mjs';
import { mapSpec, receiptSilhouette } from './icons/geometry.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** لوحة الرسم في كل المصادر. */
const VIEW = 1024;

/** حتى هذا الحجم (بالبكسل) تُستعمل النسخة المبسّطة: تفاصيل الوصل تذوب تحته. */
export const SMALL_ART_MAX = 40;

export const ICON_SOURCES = {
  background: 'resources/icon/icon-background.svg',
  foreground: 'resources/icon/icon-foreground.svg',
  small: 'resources/icon/icon-small.svg'
};

/** كثافات أندرويد ومعامل كل منها (mdpi = 1). */
export const ANDROID_DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4]
];

/** مجلد موارد أندرويد الجاهزة للنسخ كما هي إلى android/app/src/main/res. */
export const ANDROID_RES_DIR = 'resources/android/res';

/** حجم شعار شاشة البدء (dp): حجم ثابت في المنتصف بدل صورة تُمطّ على الشاشة. */
const SPLASH_LOGO_DP = 128;

/** ألوان خلفية شاشة البدء (نفس خلفية التطبيق في manifest والوضع الليلي). */
const SPLASH_BACKGROUND = { light: '#FFF8F7F5', dark: '#FF151412' };

/**
 * هندسة الرمز أحادي اللون بإحداثيات لوحة 1024 — تطابق icon-foreground.svg
 * (عند تعديل الوصل أو الختم هناك تُحدَّث هنا أيضاً). حُذف السطر الفرعي والخط
 * المنقّط لأنهما أرفع من أن يظهرا في صورة ظلية.
 */
const GLYPH_SPEC = {
  receipt: { x0: 346, x1: 746, top: 164, base: 786, teeth: 8, depth: 28, radius: 30 },
  lines: [
    [492, 223, 196, 38],
    [512, 355, 176, 26],
    [402, 355, 70, 26],
    [552, 417, 136, 26],
    [402, 417, 70, 26],
    [528, 479, 160, 26],
    [402, 479, 70, 26],
    [592, 601, 96, 30]
  ],
  seal: { cx: 390, cy: 738, r: 118, gap: 20, check: [[344, 740], [378, 774], [440, 706]], checkWidth: 30 }
};

/**
 * أيقونة الإشعارات (إطار 24dp): رسم أبسط وأسمك من الرمز الكامل لأنها تُعرض
 * بحجم 24dp في شريط الحالة — ثلاثة أسطر وختم أكبر نسبياً.
 */
const NOTIFICATION_SPEC = {
  receipt: { x0: 7.4, x1: 20.6, top: 2, base: 17.4, teeth: 4, depth: 1.6, radius: 1.4 },
  lines: [
    [11, 4.6, 7.2, 1.8],
    [12.6, 8, 5.6, 1.6],
    [14.2, 11.2, 4, 1.6]
  ],
  seal: { cx: 8.2, cy: 17.2, r: 5, gap: 1.2, check: [[5.9, 17.3], [7.5, 18.9], [10.6, 15.8]], checkWidth: 1.7 }
};

/* ------------------------------------------------------------------ */
/* المصادر والتركيب                                                    */
/* ------------------------------------------------------------------ */

function readSource(root, relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) throw new Error(`لم يُعثر على مصدر الأيقونة: ${relativePath}`);
  return readFileSync(path, 'utf8');
}

/** محتوى وثيقة SVG بلا الوسم الخارجي (للتركيب داخل وثيقة أخرى). */
function svgBody(svg) {
  return svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}

function svgDocument(body, defs = '', { size = VIEW } = {}) {
  const dimensions = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 ${VIEW} ${VIEW}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}

/** مربع فائق الإهليلجية |x|⁵+|y|⁵=1: زوايا متصلة الانحناء (أنعم من rx العادي). */
function squirclePath(inset) {
  const center = VIEW / 2;
  const radius = center - inset;
  const steps = 64;
  const points = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    for (let i = 0; i < steps; i++) {
      const t = ((quarter * steps + i) / (4 * steps)) * Math.PI * 2;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      const x = center + radius * Math.sign(cos) * Math.abs(cos) ** 0.4;
      const y = center + radius * Math.sign(sin) * Math.abs(sin) ** 0.4;
      points.push(`${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`);
    }
  }
  return `M${points.join(' L')} Z`;
}

/** هامش أيقونة أندرويد القديمة: 2dp من لوحة 48dp. */
const LEGACY_INSET = (2 / 48) * VIEW;

const SHAPES = {
  squircle: (inset) => (fill = '') => `<path d="${squirclePath(inset)}"${fill ? ` fill="${fill}"` : ''}/>`,
  circle: (inset) => (fill = '') =>
    `<circle cx="${VIEW / 2}" cy="${VIEW / 2}" r="${VIEW / 2 - inset}"${fill ? ` fill="${fill}"` : ''}/>`
};

function clipped(body, shape, shadow) {
  const defs = [`<clipPath id="plate-clip">${shape()}</clipPath>`];
  let under = '';
  if (shadow) {
    defs.push(
      `<filter id="plate-shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
        `<feDropShadow dx="0" dy="${shadow.dy}" stdDeviation="${shadow.blur}" flood-color="#000000" flood-opacity="${shadow.opacity}"/></filter>`
    );
    under = `<g filter="url(#plate-shadow)">${shape('#34452b')}</g>`;
  }
  return svgDocument(`${under}<g clip-path="url(#plate-clip)">${body}</g>`, defs.join(''));
}

/** مولّد وثائق SVG لكل شكل من أشكال الأيقونة. */
function createVariants(root) {
  const background = svgBody(readSource(root, ICON_SOURCES.background));
  const foreground = svgBody(readSource(root, ICON_SOURCES.foreground));
  const small = svgBody(readSource(root, ICON_SOURCES.small));
  const art = (size) => (size <= SMALL_ART_MAX ? small : `${background}${foreground}`);
  return {
    /** مربع كامل معتم: يقصّه النظام بنفسه (maskable، iOS، apple-touch-icon). */
    square: (size) => svgDocument(art(size)),
    /** لوحة بزوايا متصلة الانحناء وحواف شفافة (ويندوز، لينكس، PWA any، favicon). */
    plate: (size) => clipped(art(size), SHAPES.squircle(0)),
    /** أندرويد قبل 8.0: هامش 2dp وظل خفيف كما في إرشادات الأيقونات القديمة. */
    legacy: (size) => clipped(art(size), SHAPES.squircle(LEGACY_INSET), { dy: 12, blur: 10, opacity: 0.3 }),
    legacyRound: (size) => clipped(art(size), SHAPES.circle(LEGACY_INSET), { dy: 12, blur: 10, opacity: 0.3 }),
    /** ماك: شبكة Big Sur (لوحة 824 من 1024 مع ظل). */
    mac: (size) => clipped(art(size), SHAPES.squircle(100), { dy: 10, blur: 12, opacity: 0.3 }),
    /** طبقة الرمز التكيفية: الرسم الكامل يقابل الإطار المرئي 72dp من 108dp. */
    foreground: () => svgDocument(`<g transform="translate(${VIEW / 6} ${VIEW / 6}) scale(${2 / 3})">${foreground}</g>`),
    /** favicon.svg: نسخة مبسّطة قابلة للتحجيم بلا أبعاد ثابتة. */
    faviconSvg: () =>
      clipped(small, SHAPES.squircle(0)).replace(` width="${VIEW}" height="${VIEW}"`, ''),
    backgroundSvg: readSource(root, ICON_SOURCES.background)
  };
}

function render(Resvg, svg, size) {
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    shapeRendering: 2,
    font: { loadSystemFonts: false }
  }).render();
  if (image.width !== size || image.height !== size) {
    throw new Error(`حجم غير متوقع ${image.width}×${image.height} (المطلوب ${size})`);
  }
  const rgba = unpremultiply(image.pixels);
  return { size, rgba, png: encodePng(size, size, rgba) };
}

/* ------------------------------------------------------------------ */
/* موارد أندرويد النصية                                                */
/* ------------------------------------------------------------------ */

const GENERATED_NOTE = 'مُولَّد بـ npm run icons من resources/icon — لا تعدّله يدوياً';

/** تدرّج خطي من مصدر SVG (بوحدات objectBoundingBox) مع محطاته. */
function parseLinearGradient(svg, id) {
  const match = svg.match(new RegExp(`<linearGradient\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</linearGradient>`));
  if (!match) throw new Error(`لم يُعثر على التدرّج ${id} في مصدر الخلفية`);
  const attr = (text, name, fallback) => {
    const value = text.match(new RegExp(`\\b${name}="([^"]*)"`));
    return value ? value[1] : fallback;
  };
  const head = match[0].slice(0, match[0].indexOf('>'));
  const stops = [...match[1].matchAll(/<stop\b[^>]*>/g)].map(([tag]) => ({
    offset: Number(attr(tag, 'offset', '0')),
    color: attr(tag, 'stop-color', '#000000'),
    opacity: Number(attr(tag, 'stop-opacity', '1'))
  }));
  return {
    x1: Number(attr(head, 'x1', '0')),
    y1: Number(attr(head, 'y1', '0')),
    x2: Number(attr(head, 'x2', '1')),
    y2: Number(attr(head, 'y2', '0')),
    stops
  };
}

/** #rrggbb + شفافية ⇒ #AARRGGBB (صيغة ألوان أندرويد). */
function androidColor(hex, opacity = 1) {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${alpha}${value}`.toUpperCase();
}

const num = (value) => String(Math.round(value * 100) / 100);

/**
 * خلفية الأيقونة التكيفية متجهةً (108dp) بنفس تدرّجات icon-background.svg:
 * التدرّج يقابل الإطار المرئي 72dp (من 18 إلى 90) ويمتد لونه إلى الحواف.
 */
function adaptiveBackgroundXml(backgroundSvg) {
  const layers = ['bg-fill', 'bg-sheen'].map((id) => parseLinearGradient(backgroundSvg, id));
  const toViewport = (value) => 18 + value * 72;
  const paths = layers.map((gradient) =>
    [
      '    <path android:pathData="M0,0h108v108h-108z">',
      '        <aapt:attr name="android:fillColor">',
      '            <gradient',
      '                android:type="linear"',
      `                android:startX="${num(toViewport(gradient.x1))}"`,
      `                android:startY="${num(toViewport(gradient.y1))}"`,
      `                android:endX="${num(toViewport(gradient.x2))}"`,
      `                android:endY="${num(toViewport(gradient.y2))}">`,
      ...gradient.stops.map(
        (stop) =>
          `                <item android:offset="${num(stop.offset)}" android:color="${androidColor(stop.color, stop.opacity)}" />`
      ),
      '            </gradient>',
      '        </aapt:attr>',
      '    </path>'
    ].join('\n')
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- خلفية الأيقونة التكيفية: تدرّج أخضر مريمي + لمعة علوية. ${GENERATED_NOTE} -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    xmlns:aapt="http://schemas.android.com/aapt"',
    '    android:width="108dp"',
    '    android:height="108dp"',
    '    android:viewportWidth="108"',
    '    android:viewportHeight="108">',
    ...paths,
    '</vector>',
    ''
  ].join('\n');
}

function silhouetteVectorXml({ comment, size, silhouette, tint }) {
  const path = (d) =>
    ['    <path', '        android:fillColor="#FFFFFFFF"', '        android:fillType="evenOdd"', `        android:pathData="${d}" />`].join(
      '\n'
    );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- ${comment} ${GENERATED_NOTE} -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${size}dp"`,
    `    android:height="${size}dp"`,
    `    android:viewportWidth="${size}"`,
    `    android:viewportHeight="${size}"${tint ? `\n    android:tint="${tint}"` : ''}>`,
    path(silhouette.paper),
    path(silhouette.stamp),
    '</vector>',
    ''
  ].join('\n');
}

function adaptiveIconXml() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- أيقونة تكيفية (أندرويد 8+) مع طبقة أحادية اللون للأيقونات ذات السمة (أندرويد 13+). ${GENERATED_NOTE} -->`,
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@drawable/ic_launcher_background" />',
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />',
    '</adaptive-icon>',
    ''
  ].join('\n');
}

function launcherColorXml(color) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- لون خلفية الأيقونة الاحتياطي. ${GENERATED_NOTE} -->`,
    '<resources>',
    `    <color name="ic_launcher_background">${color}</color>`,
    '</resources>',
    ''
  ].join('\n');
}

function splashXml(color, mode) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- شاشة البدء (${mode}): لون خلفية التطبيق والأيقونة بحجم ثابت في المنتصف — لا تمطيط على أي شاشة. ${GENERATED_NOTE} -->`,
    '<layer-list xmlns:android="http://schemas.android.com/apk/res/android" android:opacity="opaque">',
    '    <item>',
    '        <shape android:shape="rectangle">',
    `            <solid android:color="${color}" />`,
    '        </shape>',
    '    </item>',
    '    <item>',
    '        <bitmap',
    '            android:gravity="center"',
    '            android:src="@drawable/splash_logo" />',
    '    </item>',
    '</layer-list>',
    ''
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* قائمة النواتج                                                        */
/* ------------------------------------------------------------------ */

const TAURI = 'desktop/src-tauri/icons';

const TAURI_IOS = [
  ['20x20@1x', 20],
  ['20x20@2x', 40],
  ['20x20@2x-1', 40],
  ['20x20@3x', 60],
  ['29x29@1x', 29],
  ['29x29@2x', 58],
  ['29x29@2x-1', 58],
  ['29x29@3x', 87],
  ['40x40@1x', 40],
  ['40x40@2x', 80],
  ['40x40@2x-1', 80],
  ['40x40@3x', 120],
  ['60x60@2x', 120],
  ['60x60@3x', 180],
  ['76x76@1x', 76],
  ['76x76@2x', 152],
  ['83.5x83.5@2x', 167],
  ['512@2x', 1024]
];

/** أحجام أيقونة ويندوز: كل مقاسات Explorer وشريط المهام حتى 400% تكبير. */
export const WINDOWS_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/**
 * كل الملفات المُولَّدة: `{ file, variant, size }` لصور PNG، و`ico`/`icns`
 * للحاويات، و`text` للملفات النصية.
 */
export function iconOutputs() {
  const outputs = [];
  const png = (file, variant, size) => outputs.push({ file, kind: 'png', variant, size });
  const text = (file, build) => outputs.push({ file, kind: 'text', build });

  // الويب / PWA
  text('public/favicon.svg', (v) => `${v.faviconSvg()}\n`);
  outputs.push({ file: 'public/favicon.ico', kind: 'ico', variant: 'plate', sizes: [16, 32, 48], bmpMaxSize: 0 });
  png('public/apple-touch-icon.png', 'square', 180);
  png('public/pwa-192x192.png', 'plate', 192);
  png('public/pwa-512x512.png', 'plate', 512);
  png('public/pwa-maskable-512x512.png', 'square', 512);

  // ويندوز: Electron (المثبّت والملف التنفيذي والاختصارات)
  outputs.push({ file: 'resources/icon/app.ico', kind: 'ico', variant: 'plate', sizes: WINDOWS_ICO_SIZES });

  // Tauri (نفس أسماء الملفات التي يتوقعها tauri.conf.json ومولّد tauri icon)
  png(`${TAURI}/32x32.png`, 'plate', 32);
  png(`${TAURI}/64x64.png`, 'plate', 64);
  png(`${TAURI}/128x128.png`, 'plate', 128);
  png(`${TAURI}/128x128@2x.png`, 'plate', 256);
  png(`${TAURI}/icon.png`, 'plate', 512);
  for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) png(`${TAURI}/Square${size}x${size}Logo.png`, 'plate', size);
  png(`${TAURI}/StoreLogo.png`, 'plate', 50);
  outputs.push({ file: `${TAURI}/icon.ico`, kind: 'ico', variant: 'plate', sizes: WINDOWS_ICO_SIZES });
  outputs.push({ file: `${TAURI}/icon.icns`, kind: 'icns', variant: 'mac' });
  for (const [density, factor] of ANDROID_DENSITIES) {
    png(`${TAURI}/android/mipmap-${density}/ic_launcher.png`, 'legacy', 48 * factor);
    png(`${TAURI}/android/mipmap-${density}/ic_launcher_round.png`, 'legacyRound', 48 * factor);
    png(`${TAURI}/android/mipmap-${density}/ic_launcher_foreground.png`, 'foreground', 108 * factor);
  }
  text(`${TAURI}/android/values/ic_launcher_background.xml`, (v, colors) => launcherColorXml(colors.brand));
  for (const [name, size] of TAURI_IOS) png(`${TAURI}/ios/AppIcon-${name}.png`, 'square', size);

  // أندرويد (Capacitor): موارد تُنسخ كما هي إلى المشروع المولَّد
  for (const [density, factor] of ANDROID_DENSITIES) {
    png(`${ANDROID_RES_DIR}/mipmap-${density}/ic_launcher.png`, 'legacy', 48 * factor);
    png(`${ANDROID_RES_DIR}/mipmap-${density}/ic_launcher_round.png`, 'legacyRound', 48 * factor);
    png(`${ANDROID_RES_DIR}/mipmap-${density}/ic_launcher_foreground.png`, 'foreground', 108 * factor);
    png(`${ANDROID_RES_DIR}/drawable-${density}/splash_logo.png`, 'plate', SPLASH_LOGO_DP * factor);
  }
  text(`${ANDROID_RES_DIR}/mipmap-anydpi-v26/ic_launcher.xml`, () => adaptiveIconXml());
  text(`${ANDROID_RES_DIR}/mipmap-anydpi-v26/ic_launcher_round.xml`, () => adaptiveIconXml());
  text(`${ANDROID_RES_DIR}/drawable/ic_launcher_background.xml`, (v) => adaptiveBackgroundXml(v.backgroundSvg));
  text(`${ANDROID_RES_DIR}/drawable/ic_launcher_monochrome.xml`, () =>
    silhouetteVectorXml({
      comment: 'طبقة الأيقونة أحادية اللون (الأيقونات ذات السمة): يلوّنها النظام بألوان الخلفية.',
      size: 108,
      silhouette: receiptSilhouette(mapSpec(GLYPH_SPEC, 72 / VIEW, 18, 18))
    })
  );
  text(`${ANDROID_RES_DIR}/values/ic_launcher_background.xml`, (v, colors) => launcherColorXml(colors.brand));
  text(`${ANDROID_RES_DIR}/drawable/splash.xml`, () => splashXml(SPLASH_BACKGROUND.light, 'نهاري'));
  text(`${ANDROID_RES_DIR}/drawable-night/splash.xml`, () => splashXml(SPLASH_BACKGROUND.dark, 'ليلي'));

  // أيقونة الإشعارات (smallIcon في capacitor.config.json)
  text('resources/android/ic_stat_agri.xml', () =>
    silhouetteVectorXml({
      comment: 'أيقونة الإشعارات أحادية اللون (smallIcon في capacitor.config.json): وصل وختم تسديد.',
      size: 24,
      silhouette: receiptSilhouette(NOTIFICATION_SPEC),
      tint: '#FFFFFFFF'
    })
  );
  return outputs;
}

/* ------------------------------------------------------------------ */
/* التنفيذ                                                              */
/* ------------------------------------------------------------------ */

/**
 * يولّد النواتج (أو يتحقق منها فقط مع `check: true` دون كتابة أي ملف).
 * `kinds` يحصر العمل في أنواع معيّنة ('png' | 'ico' | 'icns' | 'text')؛
 * محرّك الرسم (resvg) لا يُحمَّل إلا عند الحاجة لصورة فعلاً.
 */
export async function generateIcons({ root = repoRoot, log = () => undefined, check = false, kinds = null } = {}) {
  const variants = createVariants(root);
  const fill = parseLinearGradient(variants.backgroundSvg, 'bg-fill');
  const middle = fill.stops.reduce((best, stop) => (Math.abs(stop.offset - 0.5) < Math.abs(best.offset - 0.5) ? stop : best));
  const colors = { brand: androidColor(middle.color).replace(/^#FF/, '#') };

  const outputs = iconOutputs().filter((output) => !kinds || kinds.includes(output.kind));
  const Resvg = outputs.some((output) => output.kind !== 'text') ? (await import('@resvg/resvg-js')).Resvg : null;
  const cache = new Map();
  const image = (variant, size) => {
    const key = `${variant}:${size}`;
    if (!cache.has(key)) cache.set(key, render(Resvg, variants[variant](size), size));
    return cache.get(key);
  };

  const written = [];
  const stale = [];
  let unchanged = 0;
  for (const output of outputs) {
    let content;
    if (output.kind === 'png') content = image(output.variant, output.size).png;
    else if (output.kind === 'ico') {
      content = encodeIco(
        output.sizes.map((size) => image(output.variant, size)),
        { bmpMaxSize: output.bmpMaxSize ?? 48 }
      );
    } else if (output.kind === 'icns') {
      const sizes = [...new Set(ICNS_TYPES.map(([, size]) => size))];
      content = encodeIcns(new Map(sizes.map((size) => [size, image(output.variant, size).png])));
    } else content = Buffer.from(output.build(variants, colors), 'utf8');

    const path = join(root, output.file);
    if (existsSync(path) && readFileSync(path).equals(content)) {
      unchanged += 1;
      continue;
    }
    if (check) {
      stale.push(output.file);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(output.file);
    log(`كُتب ${output.file}`);
  }
  return { total: outputs.length, written, unchanged, stale };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const started = Date.now();
  const check = process.argv.includes('--check');
  generateIcons({ check, log: (message) => console.log(`• ${message}`) })
    .then(({ total, written, unchanged, stale }) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (check) {
        if (stale.length > 0) {
          for (const file of stale) console.error(`✖ غير مطابق للمصدر: ${file}`);
          console.error('✖ نواتج الأيقونة قديمة — نفّذ: npm run icons');
          process.exit(1);
        }
        console.log(`✔ نواتج الأيقونة مطابقة للمصادر (${total} ملفاً) خلال ${seconds} ث`);
        return;
      }
      console.log(`✔ أيقونات التطبيق: ${total} ملفاً (${written.length} كُتب، ${unchanged} دون تغيير) خلال ${seconds} ث`);
    })
    .catch((error) => {
      console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
