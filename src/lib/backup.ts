import { db, getSettings, getSettingsOrDefault, updateSettings } from './db';
import { normalizeBackup, readBackupFile } from './validate';
import { reallocateCustomerInvoices } from './invoices';
import { sanitizeFileName } from './utils';
import { saveFile } from './files';
import type { BackupData, BackupSnapshot } from '@/types';

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
  | 'activityLogs';

/** أقصى عدد نسخ داخلية محفوظة في IndexedDB. */
const MAX_SNAPSHOTS = 5;

export async function createBackup(): Promise<BackupData> {
  const [settings, users, materials, customers, invoices, invoiceItems, payments, purchases, purchaseItems, notifications, activityLogs] =
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
      db.activityLogs.toArray()
    ]);

  return {
    version: '1.2.0',
    date: new Date().toISOString(),
    officeName: settings[0]?.officeName,
    data: { settings, users, materials, customers, invoices, invoiceItems, payments, purchases, purchaseItems, notifications, activityLogs }
  };
}

export function backupFileName(officeName?: string, date: Date = new Date()): string {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
  const timeStr = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(
    date.getSeconds()
  ).padStart(2, '0')}`;
  const name = sanitizeFileName(officeName || 'AgriOffice', 'AgriOffice');
  return `${name}_Backup_${dateStr}_${timeStr}.json`;
}

async function recordBackupMeta(fileName: string, size: number, type: 'auto' | 'manual' | 'import') {
  await db.backups.add({ fileName, date: new Date().toISOString(), size, type });
  await updateSettings({ lastBackup: new Date().toISOString() }).catch((error) =>
    console.warn('تعذّر تحديث تاريخ آخر نسخة:', error)
  );
}

/* ------------------------------------------------------------------ *
 * تصدير ملف (إجراء يدوي صريح من المستخدم)
 * ------------------------------------------------------------------ */

export async function exportBackupToFile(type: 'auto' | 'manual' = 'manual'): Promise<string> {
  const backupData = await createBackup();
  const jsonString = JSON.stringify(backupData, null, 2);
  const fileName = backupFileName(backupData.officeName);

  // الحفظ عبر الخدمة الموحّدة: مستندات/مشاركة على أندرويد، صندوق حفظ
  // على ويندوز، تنزيل في المتصفح.
  const result = await saveFile({
    fileName,
    mimeType: 'application/json',
    data: jsonString,
    encoding: 'utf8',
    subDir: 'Backups',
    shareTitle: `نسخة احتياطية - ${backupData.officeName || 'المكتب الزراعي'}`
  });

  if (!result.ok) {
    if (result.error === 'CANCELLED') throw new Error('BACKUP_CANCELLED');
    throw new Error(result.error || 'تعذّر حفظ النسخة الاحتياطية');
  }

  await recordBackupMeta(fileName, jsonString.length, type);
  return fileName;
}

/* ------------------------------------------------------------------ *
 * النسخ الداخلية (IndexedDB) — بديل آمن عن تنزيل ملف كل ساعة
 * ------------------------------------------------------------------ */

/** توقيع مختصر للبيانات يمنع تكرار نسخ متطابقة. */
async function computeDataSignature(): Promise<string> {
  const counts = await Promise.all([
    db.materials.count(),
    db.customers.count(),
    db.invoices.count(),
    db.invoiceItems.count(),
    db.payments.count(),
    db.purchases.count(),
    db.purchaseItems.count(),
    db.notifications.count(),
    db.activityLogs.count(),
    db.settings.count()
  ]);
  const lastInvoice = await db.invoices.orderBy('id').last();
  const lastPayment = await db.payments.orderBy('id').last();
  const lastPurchase = await db.purchases.orderBy('id').last();
  const lastActivity = await db.activityLogs.orderBy('id').last();
  return [
    ...counts,
    lastInvoice?.updatedAt ?? lastInvoice?.createdAt ?? '',
    lastPayment?.createdAt ?? '',
    lastPurchase?.createdAt ?? '',
    lastActivity?.timestamp ?? ''
  ].join('|');
}

export async function saveSnapshot(type: 'auto' | 'manual' = 'auto'): Promise<BackupSnapshot | null> {
  const signature = await computeDataSignature();
  const latest = await db.snapshots.orderBy('date').last();
  if (type === 'auto' && latest?.signature && latest.signature === signature) {
    return null; // لا تغيير في البيانات
  }

  const payload = JSON.stringify(await createBackup());
  const snapshotId = (await db.snapshots.add({
    date: new Date().toISOString(),
    type,
    size: payload.length,
    payload,
    signature
  })) as number;

  // الإبقاء على آخر N نسخ فقط
  const all = await db.snapshots.orderBy('date').reverse().primaryKeys();
  const stale = all.slice(MAX_SNAPSHOTS);
  if (stale.length) await db.snapshots.bulkDelete(stale);

  await updateSettings({ lastBackup: new Date().toISOString() }).catch((error) =>
    console.warn('تعذّر تحديث تاريخ آخر نسخة:', error)
  );

  return (await db.snapshots.get(snapshotId)) ?? null;
}

export async function listSnapshots(): Promise<Omit<BackupSnapshot, 'payload'>[]> {
  const rows = await db.snapshots.orderBy('date').reverse().toArray();
  return rows.map(({ payload: _payload, ...rest }) => rest);
}

export async function deleteSnapshot(id: number): Promise<void> {
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
 * استعادة نسخة مُتحقَّق منها داخل معاملة واحدة.
 * أي فشل يُعيد القاعدة إلى حالتها السابقة بالكامل (لا مسح جزئي للبيانات).
 */
export async function restoreBackupData(backupData: BackupData, warnings: string[] = []): Promise<RestoreResult> {
  const normalized = normalizeBackup(backupData);
  if (!normalized.ok) throw new Error(normalized.error);

  const data = normalized.value.data;
  const allWarnings = [...warnings, ...normalized.warnings];

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
      db.activityLogs
    ],
    async () => {
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
    }
  );

  // ضمان وجود إعدادات صالحة حتى لو كانت النسخة قديمة/ناقصة
  const settings = await getSettings();
  if (!settings) {
    const fallback = await getSettingsOrDefault();
    await db.settings.add(fallback);
    allWarnings.push('لم تحتوي النسخة على إعدادات، تم إنشاء إعدادات افتراضية');
  }

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
      activityLogs: data.activityLogs.length
    }
  };
}

export async function importBackup(file: File): Promise<RestoreResult> {
  const raw = await readBackupFile(file);
  const normalized = normalizeBackup(raw);
  if (!normalized.ok) throw new Error(normalized.error);

  const result = await restoreBackupData(normalized.value, normalized.warnings);

  await db.backups.add({
    fileName: `Imported_${sanitizeFileName(file.name, 'backup')}`,
    date: new Date().toISOString(),
    size: file.size,
    type: 'import'
  });

  // نسخة أمان داخلية بعد الاستيراد مباشرة
  await saveSnapshot('auto').catch((error) => console.warn('تعذّر إنشاء نسخة بعد الاستيراد:', error));

  return result;
}

export async function restoreSnapshot(id: number): Promise<RestoreResult> {
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
