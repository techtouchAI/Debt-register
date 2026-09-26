const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

/** أسماء أجهزة ويندوز المحجوزة — `CON.pdf` يفشل الحفظ بصمت إن قُبل. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const ILLEGAL_CHARS = new RegExp('[<>:"|?*' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']');

/**
 * اسم ملف فقط، بلا مسار. يرفض فواصل Windows وPOSIX وأحرف ويندوز الممنوعة
 * والأسماء المحجوزة، حتى لو فُحص المشروع على لينكس حيث `path.basename`
 * لا يفهم الشرطة المائلة العكسية.
 */
function safeFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName !== fileName.trim()) return null;
  if (ILLEGAL_CHARS.test(fileName) || /[\\/]/.test(fileName) || /[. ]$/.test(fileName)) return null;
  const base = path.basename(fileName);
  if (base !== fileName || base === '.' || base === '..') return null;
  const stem = base.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) return null;
  return base;
}

/**
 * كتابة ذرّية: ملف فريد ثم إعادة تسمية. على ويندوز تُستبدل الوجهة إن لم تكن
 * مقفلة؛ الملف المؤقت يُحذف في finally حتى بعد فشل إعادة التسمية.
 */
async function writeFileAtomically(filePath, data, options) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tempPath, data, options);
    try {
      await fsp.rename(tempPath, filePath);
    } catch (error) {
      const code = error && error.code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
      // الاستبدال بالنسخ يُبقي الملف الأصلي إذا فشلت الكتابة، بدل حذفه أولاً.
      await fsp.copyFile(tempPath, filePath);
    }
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
}

/** يثبت مسار الكتابة على نظام الملفات الفعلي (يُستدعى من اختبار الدخان). */
async function runFilesystemSmoke(dir) {
  if (safeFileName('فاتورة 1.pdf') !== 'فاتورة 1.pdf') throw new Error('رُفض اسم عربي صالح');
  for (const bad of ['../evil.txt', 'foo/bar.txt', 'foo\\bar.txt', 'CON.txt', 'nul.pdf', 'file.', 'bad:name.txt', ' aux.txt']) {
    if (safeFileName(bad)) throw new Error(`قُبل اسم غير صالح: ${bad}`);
  }
  const target = path.join(dir, 'smoke-io.txt');
  await writeFileAtomically(target, 'أول', 'utf8');
  await writeFileAtomically(target, 'ثاني', 'utf8');
  const text = await fsp.readFile(target, 'utf8');
  if (text !== 'ثاني') throw new Error('الكتابة الذرية لم تستبدل الملف الموجود');
  await fsp.rm(target, { force: true });
}

module.exports = { safeFileName, writeFileAtomically, runFilesystemSmoke };
