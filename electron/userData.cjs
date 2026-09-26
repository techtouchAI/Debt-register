const fs = require('fs');
const path = require('path');

/**
 * مجلد بيانات ثابت لا يتغير مع اسم العرض العربي.
 * Electron يشتق المسار الافتراضي من productName، وتبديل الاسم كان يُظهر
 * قاعدة فارغة. النسخة المحمولة والمثبّتة تتشاركان هذا المجلد عند أول نقل.
 */
const CANONICAL_DIR_NAME = 'debt-register-office';
const LINK_FILE_NAME = 'data-location.json';
const PORTABLE_FOLDER_NAME = 'AgriOfficeData';
const DB_MARKER = 'IndexedDB';

const LEGACY_DIR_NAMES = ['إدارة المكتب', 'إدارة المكتب الزراعي', 'debt-register-agri-office', 'com.agrioffice.debtregister'];

function hasDatabase(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, DB_MARKER));
  } catch {
    return false;
  }
}

function databaseStamp(dir) {
  try {
    return fs.statSync(path.join(dir, DB_MARKER)).mtimeMs || 0;
  } catch {
    return 0;
  }
}

function isInside(parent, child) {
  const base = path.resolve(parent);
  const target = path.resolve(child);
  return target === base || target.startsWith(base + path.sep);
}

function copyDatabase(from, to) {
  if (!hasDatabase(from) || hasDatabase(to)) return false;
  const source = path.resolve(from);
  const dest = path.resolve(to);
  if (isInside(source, dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true, force: false, errorOnExist: false });
  return hasDatabase(dest);
}

function linkFile(appDataDir) {
  return path.join(appDataDir, CANONICAL_DIR_NAME, LINK_FILE_NAME);
}

function readLink(appDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(linkFile(appDataDir), 'utf8'));
    if (parsed && typeof parsed.path === 'string' && parsed.path) return parsed;
  } catch {
    /* لا مؤشر بعد — تثبيت جديد أو نسخة أقدم */
  }
  return null;
}

function writeLink(appDataDir, record) {
  const file = linkFile(appDataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record));
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function legacyCandidates(appDataDir, canonical) {
  return LEGACY_DIR_NAMES.map((name) => path.join(appDataDir, name)).filter(
    (dir) => path.resolve(dir) !== path.resolve(canonical) && hasDatabase(dir)
  );
}

function newestDatabase(dirs) {
  return dirs.filter(Boolean).filter(hasDatabase).sort((left, right) => databaseStamp(right) - databaseStamp(left))[0] || null;
}

/**
 * يختار مجلد البيانات قبل فتح Chromium حتى لا تُقفل ملفات IndexedDB أثناء النسخ.
 *
 * - المحمولة: بجانب الملف التنفيذي حتى تسافر مع النسخة.
 * - المثبّتة: مجلد ثابت في AppData.
 * - إن كان أحد الجانبين فارغاً والآخر فيه قاعدة، تُنسخ الأحدث مرة واحدة.
 *   لا يُستبدل مجلد فيه بيانات أصلاً، حتى لا تُمحى فواتير أحدث.
 */
function resolveUserDataDir({ appDataDir, portableDir, extraCandidates = [], now = () => new Date().toISOString(), warn = () => {} }) {
  if (!appDataDir) throw new Error('appDataDir مطلوب');
  const canonical = path.join(appDataDir, CANONICAL_DIR_NAME);
  fs.mkdirSync(canonical, { recursive: true });

  const safeCopy = (from, to) => {
    try {
      return copyDatabase(from, to);
    } catch (error) {
      warn(error);
      return false;
    }
  };

  if (portableDir) {
    const portableData = path.join(portableDir, PORTABLE_FOLDER_NAME);
    fs.mkdirSync(portableData, { recursive: true });
    if (!hasDatabase(portableData)) {
      const source = newestDatabase([canonical, ...legacyCandidates(appDataDir, canonical), ...extraCandidates]);
      if (source) safeCopy(source, portableData);
    }
    try {
      writeLink(appDataDir, { mode: 'portable', path: portableData, updatedAt: now() });
    } catch (error) {
      warn(error);
    }
    return portableData;
  }

  if (!hasDatabase(canonical)) {
    const link = readLink(appDataDir);
    const portableSource =
      link && path.basename(link.path) === PORTABLE_FOLDER_NAME && hasDatabase(link.path) ? link.path : null;
    const source = newestDatabase([...legacyCandidates(appDataDir, canonical), ...extraCandidates, portableSource]);
    if (source) safeCopy(source, canonical);
  }
  try {
    writeLink(appDataDir, { mode: 'installed', path: canonical, updatedAt: now() });
  } catch (error) {
    warn(error);
  }
  return canonical;
}

module.exports = {
  CANONICAL_DIR_NAME,
  PORTABLE_FOLDER_NAME,
  hasDatabase,
  resolveUserDataDir
};
