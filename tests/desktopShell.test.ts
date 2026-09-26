import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { printHtmlDocument } from '@/lib/print';
import { saveWithTauriApi } from '@/lib/tauriShell';

const require = createRequire(import.meta.url);
const { safeFileName, writeFileAtomically } = require('../electron/files.cjs') as {
  safeFileName: (name: string) => string | null;
  writeFileAtomically: (filePath: string, data: string, encoding: string) => Promise<void>;
};
const { classifyPrintCallback } = require('../electron/printResult.cjs') as {
  classifyPrintCallback: (success: boolean, reason?: string) => { success: boolean; cancelled: boolean; error?: string };
};
const { isSameFilePathname } = require('../electron/ipcGuard.cjs') as {
  isSameFilePathname: (left: string, right: string, platform?: string) => boolean;
};
const { resolveUserDataDir, hasDatabase } = require('../electron/userData.cjs') as {
  resolveUserDataDir: (options: { appDataDir: string; portableDir?: string }) => string;
  hasDatabase: (dir: string) => boolean;
};

describe('أسماء الملفات والطباعة', () => {
  it('يرفض المسارات والأسماء المحجوزة ويقبل الاسم العربي', () => {
    expect(safeFileName('فاتورة 1.pdf')).toBe('فاتورة 1.pdf');
    for (const bad of ['../evil.txt', 'foo/bar.txt', 'foo\\bar.txt', 'CON.txt', 'nul.pdf', 'file.', 'bad:name.txt', ' aux.txt']) {
      expect(safeFileName(bad), bad).toBeNull();
    }
  });

  it('يعدّ إلغاء الطباعة إلغاءً لا نجاحاً ولا خطأ معروضاً', () => {
    expect(classifyPrintCallback(false, '')).toEqual({ success: false, cancelled: true });
    expect(classifyPrintCallback(false, 'Print job canceled')).toMatchObject({ success: false, cancelled: true });
    expect(classifyPrintCallback(false, 'printer offline')).toMatchObject({ success: false, cancelled: false, error: 'printer offline' });
    expect(classifyPrintCallback(true, 'canceled')).toEqual({ success: true, cancelled: false });
  });

  it('لا يعدّ إلغاء حوار ويندوز فشلاً في الواجهة', async () => {
    window.electronAPI = { printDocument: async () => ({ success: true, cancelled: true }) };
    await expect(printHtmlDocument('فاتورة', '<p>نص</p>')).resolves.toBe('cancelled');
    delete window.electronAPI;
  });

  it('يقارن مسار ويندوز دون حساسية لحالة حرف القرص', () => {
    expect(isSameFilePathname('/C:/App/index.html', '/c:/App/index.html', 'win32')).toBe(true);
    expect(isSameFilePathname('/C:/App/index.html', '/c:/App/other.html', 'win32')).toBe(false);
    expect(isSameFilePathname('/App/Index.html', '/App/index.html', 'linux')).toBe(false);
  });
});

describe('نقل بيانات المكتب', () => {
  it('ينسخ القاعدة الأقدم إلى المجلد الثابت ولا يحذف الأصل', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-data-'));
    const legacy = path.join(root, 'إدارة المكتب');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'IndexedDB'), 'فواتير');
    const chosen = resolveUserDataDir({ appDataDir: root });
    expect(path.basename(chosen)).toBe('debt-register-office');
    expect(await readFile(path.join(chosen, 'IndexedDB'), 'utf8')).toBe('فواتير');
    expect(hasDatabase(legacy)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it('لا يستبدل قاعدة موجودة ولا يتبع مؤشراً خارج مجلد النسخة المحمولة', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-data-'));
    const canonical = path.join(root, 'debt-register-office');
    const foreign = path.join(root, 'elsewhere');
    await mkdir(canonical, { recursive: true });
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(canonical, 'IndexedDB'), 'الحالية');
    await writeFile(path.join(foreign, 'IndexedDB'), 'غريبة');
    await writeFile(path.join(canonical, 'data-location.json'), JSON.stringify({ mode: 'portable', path: foreign }));
    const chosen = resolveUserDataDir({ appDataDir: root });
    expect(await readFile(path.join(chosen, 'IndexedDB'), 'utf8')).toBe('الحالية');
    await rm(root, { recursive: true, force: true });
  });

  it('ينسخ مجلد البيانات الافتراضي الحالي إن لم يكن ضمن الأسماء المعروفة', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-data-'));
    const current = path.join(root, 'اسم-اشتقه-النظام');
    await mkdir(current, { recursive: true });
    await writeFile(path.join(current, 'IndexedDB'), 'افتراضية');
    const chosen = resolveUserDataDir({ appDataDir: root, extraCandidates: [current] });
    expect(await readFile(path.join(chosen, 'IndexedDB'), 'utf8')).toBe('افتراضية');
    expect(await readFile(path.join(current, 'IndexedDB'), 'utf8')).toBe('افتراضية');
    await rm(root, { recursive: true, force: true });
  });

  it('ينقل القاعدة الفارغة في النسخة المحمولة من المجلد الثابت', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-data-'));
    const portable = await mkdtemp(path.join(tmpdir(), 'office-portable-'));
    const canonical = path.join(root, 'debt-register-office');
    await mkdir(canonical, { recursive: true });
    await writeFile(path.join(canonical, 'IndexedDB'), 'مثبتة');
    const chosen = resolveUserDataDir({ appDataDir: root, portableDir: portable });
    expect(path.basename(chosen)).toBe('AgriOfficeData');
    expect(await readFile(path.join(chosen, 'IndexedDB'), 'utf8')).toBe('مثبتة');
    expect(hasDatabase(canonical)).toBe(true);
    await rm(root, { recursive: true, force: true });
    await rm(portable, { recursive: true, force: true });
  });
});

describe('الكتابة الذرية وحفظ Tauri', () => {
  it('يستبدل الملف الموجود ولا يترك ملفاً مؤقتاً', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'office-io-'));
    const target = path.join(dir, 'فاتورة.txt');
    await writeFileAtomically(target, 'أول', 'utf8');
    await writeFileAtomically(target, 'ثاني', 'utf8');
    expect(await readFile(target, 'utf8')).toBe('ثاني');
    await rm(dir, { recursive: true, force: true });
  });

  it('يستخدم اسم الملف إذا رُفض مجلد التنزيلات ويميز الإلغاء', async () => {
    const writes: string[] = [];
    const saved = await saveWithTauriApi('كشف.pdf', new Uint8Array([1, 2]), 'مستند', {
      suggestedPath: async () => {
        throw new Error('not allowed');
      },
      save: async (options) => options?.defaultPath ?? null,
      writeFile: async (filePath) => {
        writes.push(filePath);
      }
    });
    expect(saved).toEqual({ ok: true, path: 'كشف.pdf' });
    expect(writes).toEqual(['كشف.pdf']);

    const cancelled = await saveWithTauriApi('كشف.pdf', new Uint8Array([1]), 'مستند', {
      save: async () => null,
      writeFile: async () => {
        throw new Error('لا يجب الكتابة بعد الإلغاء');
      }
    });
    expect(cancelled).toMatchObject({ ok: false, cancelled: true });
  });
});
