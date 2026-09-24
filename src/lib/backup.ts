import { logBackgroundFailure } from './lifecycle';
import { assertPermission } from './session';
import { db, getSettings, getSettingsOrDefault, refreshSettings, updateSettings } from './db';
import { normalizeBackup, readBackupFile } from './validate';
import { reallocateCustomerInvoices } from './invoices';
import { MAX_FILE_NAME_BYTES, sanitizeFileName, utf8ByteLength } from './utils';
import { describeSavedLocation, saveFile } from './files';
import { isPortableMetaKey, isSequenceMetaKey } from './metaKeys';
import { APP_VERSION } from './appInfo';
import { applyThemePreference } from './themePreference';
import type { AppMeta, BackupCounts, BackupData, BackupIntegrity, BackupSnapshot } from '@/types';

export type { BackupData };

type TableKey =
  | 'settings'
  | 'users'
  | 'materials'
  | 'customers'
  | 'invoices'
  | 'invoiceItems'
  | 'payments'
  | 'purchases'
  | 'purchaseItems'
  | 'notifications'
  | 'activityLogs'
  | 'meta';

/** ترتيب الجداول في النسخة (يُستخدم للعدّ والتحقق والرسائل). */
const BACKUP_TABLES: readonly TableKey[] = [
  'settings',
  'users',
  'materials',
  'customers',
  'invoices',
  'invoiceItems',
  'payments',
  'purchases',
  'purchaseItems',
  'notifications',
  'activityLogs',
  'meta'
];

/** أسماء الجداول بالعربية لرسائل التحقق. */
const TABLE_LABELS: Record<TableKey, string> = {
  settings: 'الإعدادات',
  users: 'المستخدمون',
  materials: 'المواد',
  customers: 'الزبائن',
  invoices: 'الفواتير',
  invoiceItems: 'بنود الفواتير',
  payments: 'التسديدات',
  purchases: 'وصول الشراء',
  purchaseItems: 'بنود وصول الشراء',
  notifications: 'الإشعارات',
  activityLogs: 'سجل النشاط',
  meta: 'بيانات التسلسل والدخول'
};

/** أقصى عدد نسخ داخلية محفوظة في IndexedDB. */
const MAX_SNAPSHOTS = 5;

/** إصدار بنية ملف النسخة (يُرفع عند إضافة أقسام جديدة). */
export const BACKUP_FORMAT_VERSION = '1.3.0';

/**
 * بادئة اسم ملف النسخة الاحتياطية حين لا يكون اسم المكتب معروفاً بعد
 * (اسم عام محايد — الاسم الفعلي يأتي دائماً من إعدادات المستخدم).
 */
const DEFAULT_FILE_PREFIX = 'المكتب';

/** مجلد النسخ داخل مجلد التطبيق (أندرويد: المستندات، ويندوز: صندوق الحفظ). */
export const BACKUP_SUBDIR = 'النسخ الاحتياطية';

/* ------------------------------------------------------------------ *
 * البصمة والعدّ
 * ------------------------------------------------------------------ */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** بصمة SHA-256 لنص (أو null إن لم يتوفر WebCrypto في هذا السياق). */
async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
    if (!subtle) return null;
    return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  } catch {
    return null;
  }
}

/** بصمة بديلة سريعة (FNV-1a) حين لا يتوفر WebCrypto — للمقارنة فقط. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv-${hash.toString(16).padStart(8, '0')}-${text.length}`;
}

function countRecords(data: BackupData['data']): BackupCounts {
  const counts: BackupCounts = {};
  for (const table of BACKUP_TABLES) {
    const rows = data[table as keyof BackupData['data']];
    counts[table as keyof BackupData['data']] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

/**
 * بصمة المحتوى للمقارنة بين نسختين (هل تغيّرت البيانات؟).
 * تُستثنى القيم المتغيّرة ذاتياً (آخر نسخة، آخر دخول) وإلا اعتُبرت كل نسخة
 * تلقائية "تغييراً" بسبب النسخة السابقة نفسها.
 */
async function contentSignature(data: BackupData['data']): Promise<string> {
  const stable = {
    ...data,
    settings: data.settings.map(({ lastBackup: _lastBackup, ...rest }) => rest),
    users: data.users.map(({ lastLogin: _lastLogin, ...rest }) => rest)
  };
  const text = JSON.stringify(stable);
  return (await sha256Hex(text)) ?? fnv1a(text);
}

/* ------------------------------------------------------------------ *
 * الإنشاء
 * ------------------------------------------------------------------ */

/**
 * لقطة كاملة ومتّسقة لكل بيانات المكتب.
 *
 * القراءة داخل معاملة قراءة واحدة: لا يمكن أن تُحفظ فاتورة بين قراءة جدول
 * الفواتير وقراءة بنودها فتخرج النسخة ناقصة البنود. تشمل النسخة:
 * الإعدادات (اسم المكتب والشعار والعملة والتذييل والسمة...)، المستخدمين،
 * المواد، الزبائن، الفواتير وبنودها، التسديدات، وصول الشراء وبنودها،
 * الإشعارات، سجل النشاط، وبيانات التسلسل والدخول المحمولة.
 */
export async function createBackup(): Promise<BackupData> {
  const data = await db.transaction(
    'r',
    [
      db.settings,
      db.users,
      db.materials,
      db.customers,
      db.invoices,
      db.invoiceItems,
      db.payments,
      db.purchases,
      db.purchaseItems,
      db.notifications,
      db.activityLogs,
      db.meta
    ],
    async () => {
      const [settings, users, materials, customers, invoices, invoiceItems, payments, purchases, purchaseItems, notifications, activityLogs, meta] =
        await Promise.all([
          db.settings.toArray(),
          db.users.toArray(),
          db.materials.toArray(),
          db.customers.toArray(),
          db.invoices.toArray(),
          db.invoiceItems.toArray(),
          db.payments.toArray(),
          db.purchases.toArray(),
          db.purchaseItems.toArray(),
          db.notifications.toArray(),
          db.activityLogs.toArray(),
          db.meta.toArray()
        ]);
      return {
        settings,
        users,
        materials,
        customers,
        invoices,
        invoiceItems,
        payments,
        purchases,
        purchaseItems,
        notifications,
        activityLogs,
        meta: meta.filter((entry): entry is AppMeta => isPortableMetaKey(entry.key))
      };
    }
  );

  return {
    version: BACKUP_FORMAT_VERSION,
    date: new Date().toISOString(),
    officeName: data.settings[0]?.officeName,
    appVersion: APP_VERSION,
    counts: countRecords(data),
    data
  };
}

/** بصمة سلامة قسم البيانات (تُكتب في الملف المصدَّر). */
export async function computeBackupIntegrity(data: BackupData['data']): Promise<BackupIntegrity | undefined> {
  const hash = await sha256Hex(JSON.stringify(data));
  return hash ? { algorithm: 'SHA-256', hash } : undefined;
}

/**
 * التحقق من سلامة نسخة مقروءة من ملف (قبل التطبيع).
 * يُعيد تحذيرات عربية فقط — لا يمنع الاستيراد، لأن الملف قد يكون عُدّل
 * يدوياً بقصد، والقرار للمستخدم بعد رؤية التحذير.
 */
export async function verifyBackupIntegrity(raw: unknown): Promise<string[]> {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return warnings;
  const record = raw as Record<string, unknown>;
  const integrity = record.integrity as BackupIntegrity | undefined;
  if (integrity?.algorithm === 'SHA-256' && typeof integrity.hash === 'string' && record.data !== undefined) {
    const actual = await sha256Hex(JSON.stringify(record.data));
    if (actual && actual !== integrity.hash.toLowerCase()) {
      warnings.push('بصمة الملف لا تطابق محتواه: قد يكون الملف معدّلاً أو تالفاً جزئياً');
    }
  }
  return warnings;
}

/** مقارنة أعداد السجلات المعلنة في الملف بما تبقّى بعد التحقق. */
function compareCounts(declared: BackupCounts | undefined, data: BackupData['data']): string[] {
  if (!declared) return [];
  const actual = countRecords(data);
  const warnings: string[] = [];
  for (const table of BACKUP_TABLES) {
    const key = table as keyof BackupData['data'];
    const expected = declared[key];
    if (typeof expected !== 'number') continue;
    const found = actual[key] ?? 0;
    if (found < expected) {
      warnings.push(`${TABLE_LABELS[table]}: استُعيد ${found} من ${expected} سجل (سجلات غير صالحة أو ناقصة)`);
    }
  }
  return warnings;
}

/**
 * اسم ملف النسخة الاحتياطية: `اسم المكتب_نسخة_احتياطية_التاريخ_الوقت.json`
 *
 * اسم المكتب يُكتب كاملاً ما أمكن، لكن مع حدّ **بايتات** إجمالي لاسم الملف
 * حتى لا يتجاوز حدود أنظمة الملفات (Windows/Android/ext4) خصوصاً مع الأسماء
 * العربية الطويلة (كل حرف عربي بايتان). الطوابع الزمنية لا تُقتطع أبداً،
 * ولا يُقتطع الاسم المحفوظ داخل الملف نفسه — القصّ يخص اسم الملف فقط.
 */
export function backupFileName(officeName?: string, date: Date = new Date()): string {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
  const timeStr = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(
    date.getSeconds()
  ).padStart(2, '0')}`;
  const suffix = `_نسخة_احتياطية_${dateStr}_${timeStr}.json`;
  const availableForName = Math.max(24, MAX_FILE_NAME_BYTES - utf8ByteLength(suffix));
  const name = sanitizeFileName(officeName || DEFAULT_FILE_PREFIX, DEFAULT_FILE_PREFIX, availableForName);
  return `${name}${suffix}`;
}

/** اسم ملف عند الاستيراد: يوضح أن الملف مستورد مع لقطة من اسمه الأصلي. */
export function importedBackupFileName(originalFileName: string, date: Date = new Date()): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const suffix = `_مستوردة_${stamp}.json`;
  const availableForName = Math.max(24, MAX_FILE_NAME_BYTES - utf8ByteLength(suffix));
  const base = originalFileName.replace(/\.json$/i, '');
  return `${sanitizeFileName(base, 'نسخة', availableForName)}${suffix}`;
}

async function recordBackupMeta(fileName: string, size: number, type: 'auto' | 'manual' | 'import') {
  await db.backups.add({ fileName, date: new Date().toISOString(), size, type });
  await updateSettings({ lastBackup: new Date().toISOString() }).catch((error) =>
    logBackgroundFailure('تعذّر تحديث تاريخ آخر نسخة:', error)
  );
}

/* ------------------------------------------------------------------ *
 * تصدير ملف (إجراء يدوي صريح من المستخدم)
 * ------------------------------------------------------------------ */

/** نتيجة التصدير: اسم الملف ووصف عربي لمكان حفظه (يختلف حسب المنصة). */
export interface ExportedBackup {
  fileName: string;
  message: string;
}

export async function exportBackupToFile(type: 'auto' | 'manual' = 'manual'): Promise<ExportedBackup> {
  // الملف يحوي كل بيانات المكتب (وبصمات رموز المستخدمين): للمدير فقط
  assertPermission('backup.manage');
  const backupData = await createBackup();
  backupData.integrity = await computeBackupIntegrity(backupData.data);
  const jsonString = JSON.stringify(backupData, null, 2);
  const fileName = backupFileName(backupData.officeName);

  // الحفظ عبر الخدمة الموحّدة: مستندات/مشاركة على أندرويد، صندوق حفظ
  // على ويندوز، تنزيل في المتصفح.
  const result = await saveFile({
    fileName,
    mimeType: 'application/json',
    data: jsonString,
    encoding: 'utf8',
    subDir: BACKUP_SUBDIR,
    shareTitle: `نسخة احتياطية - ${backupData.officeName || 'المكتب'}`
  });

  if (!result.ok) {
    if (result.error === 'CANCELLED') throw new Error('BACKUP_CANCELLED');
    throw new Error(result.error || 'تعذّر حفظ النسخة الاحتياطية');
  }

  await recordBackupMeta(fileName, new Blob([jsonString]).size, type);
  return { fileName, message: describeSavedLocation(result, fileName) };
}

/* ------------------------------------------------------------------ *
 * النسخ الداخلية (IndexedDB) — بديل آمن عن تنزيل ملف كل ساعة
 * ------------------------------------------------------------------ */

/**
 * إنشاء نسخة داخلية.
 *
 * التوقيع = بصمة المحتوى الكامل (لا عدد السجلات فقط): تعديل فاتورة قديمة أو
 * تغيير شعار المكتب أو إضافة مستخدم كلها تغييرات تستحق نسخة جديدة، وكان
 * التوقيع السابق (أعداد + آخر سجل) يتجاهلها فتضيع من النسخ التلقائية.
 */
export async function saveSnapshot(type: 'auto' | 'manual' = 'auto'): Promise<BackupSnapshot | null> {
  // النسخ التلقائية مهمة نظام تعمل أياً كان المستخدم؛ اليدوية للمدير
  if (type === 'manual') assertPermission('backup.manage');
  const backup = await createBackup();
  const signature = await contentSignature(backup.data);
  const latest = await db.snapshots.orderBy('date').last();
  if (type === 'auto' && latest?.signature && latest.signature === signature) {
    return null; // لا تغيير في البيانات
  }

  const payload = JSON.stringify(backup);
  const snapshotId = (await db.snapshots.add({
    date: new Date().toISOString(),
    type,
    size: new Blob([payload]).size,
    payload,
    signature
  })) as number;

  // الإبقاء على آخر N نسخ فقط
  const all = await db.snapshots.orderBy('date').reverse().primaryKeys();
  const stale = all.slice(MAX_SNAPSHOTS);
  if (stale.length) await db.snapshots.bulkDelete(stale);

  await updateSettings({ lastBackup: new Date().toISOString() }).catch((error) =>
    logBackgroundFailure('تعذّر تحديث تاريخ آخر نسخة:', error)
  );

  return (await db.snapshots.get(snapshotId)) ?? null;
}

export async function listSnapshots(): Promise<Omit<BackupSnapshot, 'payload'>[]> {
  const rows = await db.snapshots.orderBy('date').reverse().toArray();
  return rows.map(({ payload: _payload, ...rest }) => rest);
}

export async function deleteSnapshot(id: number): Promise<void> {
  assertPermission('backup.manage');
  await db.snapshots.delete(id);
}

/* ------------------------------------------------------------------ *
 * الاستعادة
 * ------------------------------------------------------------------ */

export interface RestoreResult {
  warnings: string[];
  counts: Record<TableKey, number>;
}

/**
 * دمج بيانات التسلسل والدخول المستعادة مع الموجودة على الجهاز.
 *
 * - علامات التسلسل `seq:*`: تُؤخذ القيمة **الأكبر**. استعادة نسخة قديمة على
 *   الجهاز نفسه يجب ألا تعيد أرقام فواتير صدرت بعدها (نسخها الورقية بيد
 *   الزبائن)، واستعادتها على جهاز جديد يجب ألا تعيد أرقاماً محذوفة.
 * - بقية القيم المحمولة: تُؤخذ من النسخة (تطابق المستخدمين المستعادين).
 */
async function mergePortableMeta(incoming: AppMeta[]): Promise<void> {
  for (const entry of incoming) {
    if (!isPortableMetaKey(entry.key)) continue;
    if (isSequenceMetaKey(entry.key)) {
      const current = await db.meta.get(entry.key);
      const localValue = Number(current?.value);
      const incomingValue = Number(entry.value);
      if (!Number.isFinite(incomingValue)) continue;
      const value = Number.isFinite(localValue) ? Math.max(localValue, incomingValue) : incomingValue;
      await db.meta.put({ key: entry.key, value });
      continue;
    }
    await db.meta.put({ key: entry.key, value: entry.value });
  }
}

/**
 * استعادة نسخة مُتحقَّق منها داخل معاملة واحدة.
 * أي فشل يُعيد القاعدة إلى حالتها السابقة بالكامل (لا مسح جزئي للبيانات).
 */
export async function restoreBackupData(backupData: BackupData, warnings: string[] = []): Promise<RestoreResult> {
  assertPermission('backup.manage');
  const normalized = normalizeBackup(backupData);
  if (!normalized.ok) throw new Error(normalized.error);

  const data = normalized.value.data;
  const meta = data.meta ?? [];
  const allWarnings = [...warnings, ...normalized.warnings, ...compareCounts(normalized.value.counts, data)];

  await db.transaction(
    'rw',
    [
      db.settings,
      db.users,
      db.materials,
      db.customers,
      db.invoices,
      db.invoiceItems,
      db.payments,
      db.purchases,
      db.purchaseItems,
      db.notifications,
      db.activityLogs,
      db.meta
    ],
    async () => {
      /* حماية من ملف مبتور أو تالف: نسخة بلا أي سجل تجاري لا يجوز أن تمحو
         بيانات مكتب قائم. (الاستيراد إلى مكتب جديد فارغ لا يزال مسموحاً.) */
      const incomingRecords =
        data.materials.length +
        data.customers.length +
        data.invoices.length +
        data.invoiceItems.length +
        data.payments.length +
        (data.purchases?.length ?? 0) +
        (data.purchaseItems?.length ?? 0);
      if (incomingRecords === 0) {
        const existingRecords =
          (await db.materials.count()) +
          (await db.customers.count()) +
          (await db.invoices.count()) +
          (await db.invoiceItems.count()) +
          (await db.payments.count()) +
          (await db.purchases.count()) +
          (await db.purchaseItems.count());
        if (existingRecords > 0) {
          throw new Error(
            'النسخة الاحتياطية لا تحتوي على أي سجلات بيانات؛ تم إلغاء الاستيراد لحماية بيانات المكتب الحالية'
          );
        }
      }

      await db.settings.clear();
      await db.users.clear();
      await db.materials.clear();
      await db.customers.clear();
      await db.invoices.clear();
      await db.invoiceItems.clear();
      await db.payments.clear();
      await db.purchases.clear();
      await db.purchaseItems.clear();
      await db.notifications.clear();
      await db.activityLogs.clear();

      await db.settings.bulkAdd(data.settings);
      if (data.users.length) await db.users.bulkAdd(data.users);
      if (data.materials.length) await db.materials.bulkAdd(data.materials);
      if (data.customers.length) await db.customers.bulkAdd(data.customers);
      if (data.invoices.length) await db.invoices.bulkAdd(data.invoices);
      if (data.invoiceItems.length) await db.invoiceItems.bulkAdd(data.invoiceItems);
      if (data.payments.length) await db.payments.bulkAdd(data.payments);
      if (data.purchases?.length) await db.purchases.bulkAdd(data.purchases);
      if (data.purchaseItems?.length) await db.purchaseItems.bulkAdd(data.purchaseItems);
      if (data.notifications.length) await db.notifications.bulkAdd(data.notifications);
      if (data.activityLogs.length) await db.activityLogs.bulkAdd(data.activityLogs);
      await mergePortableMeta(meta);
    }
  );

  // ضمان وجود إعدادات صالحة حتى لو كانت النسخة قديمة/ناقصة
  const settings = await getSettings();
  if (!settings) {
    const fallback = await getSettingsOrDefault();
    await db.settings.add(fallback);
    allWarnings.push('لم تحتوي النسخة على إعدادات، تم إنشاء إعدادات افتراضية');
  }
  // نشر الإعدادات المستعادة: التخطيط يعرض اسم المكتب من النسخة المستوردة فوراً
  const restored = await refreshSettings();
  // سمة الواجهة جزء من إعدادات المكتب: تُطبَّق كما كانت عند إنشاء النسخة
  applyThemePreference(restored?.theme);

  // مصالحة الأرصدة بعد الاستعادة حتى تتطابق حالة الفواتير مع التسديدات
  const customerIds = (await db.customers.toCollection().primaryKeys()) as number[];
  for (const customerId of customerIds) {
    await reallocateCustomerInvoices(customerId);
  }

  return {
    warnings: allWarnings,
    counts: {
      settings: data.settings.length,
      users: data.users.length,
      materials: data.materials.length,
      customers: data.customers.length,
      invoices: data.invoices.length,
      invoiceItems: data.invoiceItems.length,
      payments: data.payments.length,
      purchases: data.purchases?.length ?? 0,
      purchaseItems: data.purchaseItems?.length ?? 0,
      notifications: data.notifications.length,
      activityLogs: data.activityLogs.length,
      meta: meta.length
    }
  };
}

/** قراءة ملف نسخة والتحقق منه دون أي كتابة (لمعاينة المحتوى قبل الاستيراد). */
export interface BackupPreview {
  officeName?: string;
  date: string;
  appVersion?: string;
  counts: BackupCounts;
  warnings: string[];
}

export async function inspectBackupFile(file: File): Promise<{ preview: BackupPreview; backup: BackupData; warnings: string[] }> {
  const raw = await readBackupFile(file);
  const integrityWarnings = await verifyBackupIntegrity(raw);
  const normalized = normalizeBackup(raw);
  if (!normalized.ok) throw new Error(normalized.error);
  const warnings = [...integrityWarnings, ...normalized.warnings];
  return {
    backup: normalized.value,
    warnings,
    preview: {
      officeName: normalized.value.officeName ?? normalized.value.data.settings[0]?.officeName,
      date: normalized.value.date,
      appVersion: normalized.value.appVersion,
      counts: countRecords(normalized.value.data),
      warnings
    }
  };
}

export async function importBackup(file: File): Promise<RestoreResult> {
  const { backup, warnings } = await inspectBackupFile(file);
  return importInspectedBackup(file, backup, warnings);
}

/** استيراد نسخة سبق فحصها بـ `inspectBackupFile` (بلا قراءة الملف مرتين). */
export async function importInspectedBackup(file: File, backup: BackupData, warnings: string[]): Promise<RestoreResult> {
  const result = await restoreBackupData(backup, warnings);

  await db.backups.add({
    fileName: importedBackupFileName(file.name),
    date: new Date().toISOString(),
    size: file.size,
    type: 'import'
  });

  // نسخة أمان داخلية بعد الاستيراد مباشرة
  await saveSnapshot('auto').catch((error) => logBackgroundFailure('تعذّر إنشاء نسخة بعد الاستيراد:', error));

  return result;
}

export async function restoreSnapshot(id: number): Promise<RestoreResult> {
  assertPermission('backup.manage');
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new Error('النسخة الداخلية غير موجودة');

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.payload);
  } catch {
    throw new Error('محتوى النسخة الداخلية تالف');
  }

  const normalized = normalizeBackup(parsed);
  if (!normalized.ok) throw new Error(normalized.error);
  return restoreBackupData(normalized.value, normalized.warnings);
}

/* ------------------------------------------------------------------ *
 * الجدولة التلقائية
 * ------------------------------------------------------------------ */

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let autoBackupRunning = false;

const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * نسخ احتياطي تلقائي داخلي.
 *
 * التصميم السابق كان يُنزّل ملفاً (أو يفتح صندوق حفظ في سطح المكتب) كل ساعة،
 * وهو سلوك يُربك المستخدم ويملأ مجلد التنزيلات. الآن تُحفظ النسخ داخل
 * IndexedDB ويمكن استعادتها من صفحة النسخ الاحتياطي، ويبقى التصدير إجراءً يدوياً.
 */
export function setupAutoBackup(): () => void {
  if (autoBackupTimer) return () => stopAutoBackup();

  const tick = async () => {
    if (autoBackupRunning) return;
    autoBackupRunning = true;
    try {
      const settings = await getSettings();
      if (!settings?.autoBackupEnabled) return;

      const intervalMinutes = settings.autoBackupInterval && settings.autoBackupInterval > 0 ? settings.autoBackupInterval : 60;
      const lastBackup = settings.lastBackup ? new Date(settings.lastBackup).getTime() : 0;
      const elapsedMinutes = Number.isFinite(lastBackup) ? (Date.now() - lastBackup) / 60000 : Infinity;

      if (elapsedMinutes >= intervalMinutes) {
        const snapshot = await saveSnapshot('auto');
        if (snapshot) console.info('تم إنشاء نسخة احتياطية تلقائية داخلية');
      }
    } catch (error) {
      console.warn('فشل النسخ الاحتياطي التلقائي:', error);
    } finally {
      autoBackupRunning = false;
    }
  };

  autoBackupTimer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  if (typeof autoBackupTimer === 'object' && autoBackupTimer && 'unref' in autoBackupTimer) {
    (autoBackupTimer as { unref?: () => void }).unref?.();
  }
  // أول فحص بعد 15 ثانية من بدء التطبيق بدل لحظة الإقلاع المزدحمة
  setTimeout(() => void tick(), 15000);

  return () => stopAutoBackup();
}

export function stopAutoBackup(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}
