import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANDROID_DENSITIES,
  ANDROID_RES_DIR,
  ICON_SOURCES,
  WINDOWS_ICO_SIZES,
  generateIcons,
  iconOutputs
} from '../scripts/generate-icons.mjs';
import { readIcnsTypes, readIcoEntries, readPngInfo } from '../scripts/icons/formats.mjs';

/**
 * أيقونة التطبيق على كل الأنظمة (مولَّدة بـ `npm run icons` من resources/icon).
 *
 * سبب هذه الاختبارات: الأيقونة تُستهلك من أماكن كثيرة متفرقة (manifest الويب،
 * index.html، Electron، Tauri، موارد أندرويد) وأي ملف ناقص أو بمقاس خاطئ لا
 * يظهر إلا على الجهاز: مربع أبيض في شريط الحالة، أيقونة Capacitor الافتراضية،
 * أو أيقونة ضبابية في شريط مهام ويندوز.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file));
const readText = (file: string) => readFileSync(join(root, file), 'utf8');

type Output = { file: string; kind: string; variant?: string; size?: number; sizes?: number[] };
const outputs = iconOutputs() as Output[];

describe('نواتج الأيقونة الملتزمة في المستودع', () => {
  it('كل ناتج موجود، وكل PNG بالمقاس المطلوب', () => {
    for (const output of outputs) {
      expect(existsSync(join(root, output.file)), output.file).toBe(true);
      if (output.kind !== 'png') continue;
      const info = readPngInfo(read(output.file));
      expect(info, output.file).not.toBeNull();
      expect([info?.width, info?.height], output.file).toEqual([output.size, output.size]);
    }
  });

  it('الأيقونات التي يقصّها النظام معتمة بلا قناة شفافية (iOS وmaskable)', () => {
    const square = outputs.filter((output) => output.kind === 'png' && output.variant === 'square');
    expect(square.map((output) => output.file)).toEqual(
      expect.arrayContaining(['public/apple-touch-icon.png', 'public/pwa-maskable-512x512.png'])
    );
    for (const output of square) expect(readPngInfo(read(output.file))?.hasAlpha, output.file).toBe(false);
    // أيقونة الـ PWA العادية لها حواف شفافة (لوحة بزوايا مستديرة)
    expect(readPngInfo(read('public/pwa-512x512.png'))?.hasAlpha).toBe(true);
  });

  it('أيقونة ويندوز متعددة المقاسات حتى 256 (Electron وTauri)', () => {
    for (const file of ['resources/icon/app.ico', 'desktop/src-tauri/icons/icon.ico']) {
      const entries = readIcoEntries(read(file));
      expect(entries?.map((entry) => entry.size), file).toEqual(WINDOWS_ICO_SIZES);
      // الصغيرة BMP (أوسع توافقاً مع Explorer وNSIS) والكبيرة PNG
      expect(entries?.find((entry) => entry.size === 16)?.format, file).toBe('bmp');
      expect(entries?.find((entry) => entry.size === 256)?.format, file).toBe('png');
    }
    expect(readIcoEntries(read('public/favicon.ico'))?.map((entry) => entry.size)).toEqual([16, 32, 48]);
  });

  it('النسخة المبسّطة للأحجام الصغيرة على شبكة البكسل (حادة عند 16 و32 بكسل)', () => {
    // كل حافة مستقيمة في icon-small.svg على مضاعفات 64 وحدة من 1024 (= بكسل كامل عند
    // 16×16): حافة على نصف بكسل تُرسم صفاً رمادياً باهتاً فتذوب أسطر الوصل في favicon
    // وشريط مهام ويندوز. الدوائر (الختم) وعلامة الصح مستثناة لأنها منحنية أصلاً.
    const svg = readText(ICON_SOURCES.small);
    const rects = [...svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => tag);
    expect(rects.length).toBeGreaterThanOrEqual(4);
    for (const tag of rects) {
      for (const name of ['x', 'y', 'width', 'height']) {
        const value = Number(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? 0);
        expect(value % 64, `${name} في ${tag}`).toBe(0);
      }
    }
    // ورقة الوصل (المسار المغلق الوحيد): كل إحداثياتها على الشبكة، ومنها أسنان الحافة السفلية
    const paper = svg.match(/<path\b[^>]*\bd="(M[^"]*Z)"/)?.[1] ?? '';
    const numbers = paper.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((n) => n % 64 !== 0)).toEqual([]);
  });

  it('أيقونة ماك (icns) تحوي كل المقاسات من 16 حتى 1024', () => {
    const types = readIcnsTypes(read('desktop/src-tauri/icons/icon.icns'));
    expect(types).toEqual(expect.arrayContaining(['icp4', 'icp5', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']));
  });

  it('موارد أندرويد كاملة لكل الكثافات (قديمة + دائرية + طبقة أمامية + شعار البدء)', () => {
    for (const [density, factor] of ANDROID_DENSITIES as [string, number][]) {
      const expected: [string, number][] = [
        [`mipmap-${density}/ic_launcher.png`, 48 * factor],
        [`mipmap-${density}/ic_launcher_round.png`, 48 * factor],
        [`mipmap-${density}/ic_launcher_foreground.png`, 108 * factor],
        [`drawable-${density}/splash_logo.png`, 128 * factor]
      ];
      for (const [file, size] of expected) {
        expect(readPngInfo(read(`${ANDROID_RES_DIR}/${file}`))?.width, file).toBe(size);
      }
    }
  });

  it('الملفات النصية المولَّدة (SVG وXML) مطابقة للمصادر وللمولّد', async () => {
    // يكشف تعديل المصادر أو المولّد دون إعادة التوليد (npm run icons)
    const result = await generateIcons({ root, check: true, kinds: ['text'] });
    expect(result.total).toBeGreaterThan(5);
    expect(result.stale).toEqual([]);
  });
});

describe('أيقونات أندرويد المتجهة', () => {
  it('الأيقونة التكيفية (العادية والدائرية) بخلفية متجهة وطبقة أحادية اللون', () => {
    for (const file of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
      const xml = readText(`${ANDROID_RES_DIR}/${file}`);
      expect(xml).toContain('<background android:drawable="@drawable/ic_launcher_background" />');
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground" />');
      expect(xml).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome" />');
    }
    const background = readText(`${ANDROID_RES_DIR}/drawable/ic_launcher_background.xml`);
    expect(background).toContain('android:viewportWidth="108"');
    expect(background).toMatch(/<gradient[\s\S]*android:type="linear"/);
  });

  it('طبقة الأيقونات ذات السمة وأيقونة الإشعارات صور ظلية بيضاء بفتحات حقيقية', () => {
    const mono = readText(`${ANDROID_RES_DIR}/drawable/ic_launcher_monochrome.xml`);
    const notification = readText('resources/android/ic_stat_agri.xml');
    for (const xml of [mono, notification]) {
      expect(xml).toContain('android:fillColor="#FFFFFFFF"');
      expect(xml).toContain('android:fillType="evenOdd"');
      expect(xml).not.toMatch(/android:fillColor="#(?!FFFFFFFF)/);
    }
    // شريط الحالة يرسم الأيقونة بيضاء دائماً (وإلا تظهر مربعاً أبيض)
    expect(notification).toContain('android:tint="#FFFFFFFF"');
    expect(notification).toContain('android:viewportWidth="24"');
    expect(mono).toContain('android:viewportWidth="108"');
  });

  it('شاشة البدء لون ثابت + شعار في المنتصف (نهاري وليلي) بدل صورة ممطوطة', () => {
    const day = readText(`${ANDROID_RES_DIR}/drawable/splash.xml`);
    const night = readText(`${ANDROID_RES_DIR}/drawable-night/splash.xml`);
    for (const xml of [day, night]) {
      expect(xml).toContain('android:gravity="center"');
      expect(xml).toContain('android:src="@drawable/splash_logo"');
    }
    expect(day).toContain('#FFF8F7F5');
    expect(night).toContain('#FF151412');
  });
});

describe('ربط الأيقونة في أغلفة التشغيل', () => {
  it('الويب: favicon وأيقونة iOS في index.html، وmanifest فيه any وmaskable', () => {
    const html = readText('index.html');
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).not.toContain('vite.svg');

    const viteConfig = readText('vite.config.ts');
    expect(viteConfig).not.toContain('vite.svg');
    expect(viteConfig).toMatch(/src: 'pwa-maskable-512x512\.png',[\s\S]*?purpose: 'maskable'/);
    expect(viteConfig).toMatch(/src: 'pwa-512x512\.png',[\s\S]*?purpose: 'any'/);
  });

  it('Electron: ICO متعدد المقاسات للمثبّت ولنافذة ويندوز، ومضمَّن في الحزمة', () => {
    const builder = JSON.parse(readText('electron-builder.json'));
    expect(builder.win.icon).toMatch(/\.ico$/);
    expect(existsSync(join(root, builder.win.icon))).toBe(true);

    const main = readText('electron/main.cjs');
    // كل ملف أيقونة يشير إليه main.cjs موجود، ومشمول في ملفات الحزمة (وإلا يختفي بعد التثبيت)
    const referenced = [...main.matchAll(/'\.\.\/((?:public|resources)\/[^']+\.(?:png|ico))'/g)].map((match) => match[1]);
    expect(referenced).toEqual(expect.arrayContaining(['resources/icon/app.ico', 'public/pwa-192x192.png']));
    for (const file of referenced) {
      expect(existsSync(join(root, file)), file).toBe(true);
      const packaged = (builder.files as string[]).some(
        (pattern) => pattern === file || (pattern.endsWith('/**/*') && file.startsWith(pattern.slice(0, -4)))
      );
      expect(packaged, `${file} ضمن files في electron-builder.json`).toBe(true);
    }
  });

  it('Tauri: كل الأيقونات المذكورة في tauri.conf.json موجودة', () => {
    const tauri = JSON.parse(readText('desktop/src-tauri/tauri.conf.json'));
    expect(tauri.bundle.icon.length).toBeGreaterThan(0);
    for (const icon of tauri.bundle.icon as string[]) {
      expect(existsSync(join(root, 'desktop/src-tauri', icon)), icon).toBe(true);
    }
  });
});
