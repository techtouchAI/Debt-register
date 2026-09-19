import { db, getSettings } from './db';

export interface BackupData {
  version: string;
  date: string;
  officeName?: string;
  data: {
    settings: any[];
    users: any[];
    materials: any[];
    customers: any[];
    invoices: any[];
    invoiceItems: any[];
    payments: any[];
    notifications: any[];
    activityLogs: any[];
  };
}

export async function createBackup(type: 'auto' | 'manual' = 'manual'): Promise<BackupData> {
  const settings = await db.settings.toArray();
  const users = await db.users.toArray();
  const materials = await db.materials.toArray();
  const customers = await db.customers.toArray();
  const invoices = await db.invoices.toArray();
  const invoiceItems = await db.invoiceItems.toArray();
  const payments = await db.payments.toArray();
  const notifications = await db.notifications.toArray();
  const activityLogs = await db.activityLogs.toArray();

  const backupData: BackupData = {
    version: '1.0.0',
    date: new Date().toISOString(),
    officeName: settings[0]?.officeName,
    data: {
      settings,
      users,
      materials,
      customers,
      invoices,
      invoiceItems,
      payments,
      notifications,
      activityLogs
    }
  };

  return backupData;
}

export async function exportBackupToFile(type: 'auto' | 'manual' = 'manual'): Promise<string> {
  const backupData = await createBackup(type);
  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  const officeName = backupData.officeName ? backupData.officeName.replace(/\s+/g, '_') : 'AgriOffice';
  const fileName = `${officeName}_Backup_${dateStr}_${timeStr}.json`;
  
  // Try Capacitor Filesystem for Android (optional, works offline) - via Plugins API without static import
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap?.Plugins?.Filesystem) {
      const Filesystem = cap.Plugins.Filesystem;
      try {
        await Filesystem.writeFile({
          path: `Download/AgriOffice/${fileName}`,
          data: jsonString,
          directory: 'EXTERNAL_STORAGE',
          recursive: true
        });
        await db.backups.add({
          fileName,
          date: new Date().toISOString(),
          size: blob.size,
          type
        });
        const settings = await getSettings();
        if (settings?.id) {
          await db.settings.update(settings.id, { lastBackup: new Date().toISOString() });
        }
        return fileName;
      } catch {
        try {
          await Filesystem.writeFile({
            path: `AgriOffice/${fileName}`,
            data: jsonString,
            directory: 'DOCUMENTS',
            recursive: true
          });
          await db.backups.add({
            fileName,
            date: new Date().toISOString(),
            size: blob.size,
            type
          });
          const settings = await getSettings();
          if (settings?.id) {
            await db.settings.update(settings.id, { lastBackup: new Date().toISOString() });
          }
          return fileName;
        } catch {}
      }
    }
  } catch (e) {
    console.log('Capacitor filesystem error, falling back to web download', e);
  }

  // Try Electron save (Windows 10/11)
  try {
    if ((window as any).electronAPI?.saveBackup) {
      const result = await (window as any).electronAPI.saveBackup(fileName, jsonString);
      if (result?.success) {
        await db.backups.add({
          fileName,
          date: new Date().toISOString(),
          size: blob.size,
          type
        });
        const settings = await getSettings();
        if (settings?.id) {
          await db.settings.update(settings.id, { lastBackup: new Date().toISOString() });
        }
        return fileName;
      }
    }
  } catch (e) {
    console.log('Electron save error, falling back', e);
  }

  // Web fallback - download via browser
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Also save meta
  await db.backups.add({
    fileName,
    date: new Date().toISOString(),
    size: blob.size,
    type
  });

  // Update last backup in settings
  const settings = await getSettings();
  if (settings?.id) {
    await db.settings.update(settings.id, { lastBackup: new Date().toISOString() });
  }

  return fileName;
}

export async function importBackup(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const backupData: BackupData = JSON.parse(content);

        if (!backupData.data) {
          throw new Error('ملف النسخ الاحتياطي غير صالح');
        }

        // Clear existing data - using array for tables to avoid TS limit
        await db.transaction('rw', [db.settings, db.users, db.materials, db.customers, db.invoices, db.invoiceItems, db.payments, db.notifications, db.activityLogs, db.backups], async () => {
          await db.settings.clear();
          await db.users.clear();
          await db.materials.clear();
          await db.customers.clear();
          await db.invoices.clear();
          await db.invoiceItems.clear();
          await db.payments.clear();
          await db.notifications.clear();
          await db.activityLogs.clear();

          // Restore data
          if (backupData.data.settings?.length) await db.settings.bulkAdd(backupData.data.settings);
          if (backupData.data.users?.length) await db.users.bulkAdd(backupData.data.users);
          if (backupData.data.materials?.length) await db.materials.bulkAdd(backupData.data.materials);
          if (backupData.data.customers?.length) await db.customers.bulkAdd(backupData.data.customers);
          if (backupData.data.invoices?.length) await db.invoices.bulkAdd(backupData.data.invoices);
          if (backupData.data.invoiceItems?.length) await db.invoiceItems.bulkAdd(backupData.data.invoiceItems);
          if (backupData.data.payments?.length) await db.payments.bulkAdd(backupData.data.payments);
          if (backupData.data.notifications?.length) await db.notifications.bulkAdd(backupData.data.notifications);
          if (backupData.data.activityLogs?.length) await db.activityLogs.bulkAdd(backupData.data.activityLogs);
        });

        // Save import as backup meta in Downloads folder structure
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
        const importedFileName = `Imported_${dateStr}_${timeStr}_${file.name}`;
        
        await db.backups.add({
          fileName: importedFileName,
          date: new Date().toISOString(),
          type: 'import'
        });

        // Auto backup after import to Downloads/AgriOffice folder
        setTimeout(() => {
          exportBackupToFile('auto').catch(console.error);
        }, 1000);

        resolve();
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsText(file);
  });
}

export function setupAutoBackup() {
  // Check every minute if backup is needed
  setInterval(async () => {
    try {
      const settings = await getSettings();
      if (!settings?.autoBackupEnabled) return;
      
      const lastBackup = settings.lastBackup ? new Date(settings.lastBackup) : null;
      const now = new Date();
      const intervalMinutes = settings.autoBackupInterval || 60;
      
      if (!lastBackup || (now.getTime() - lastBackup.getTime()) / 1000 / 60 >= intervalMinutes) {
        await exportBackupToFile('auto');
        console.log('Auto backup completed');
      }
    } catch (e) {
      console.error('Auto backup failed', e);
    }
  }, 60 * 1000); // Check every minute

  // Also backup on window beforeunload
  window.addEventListener('beforeunload', () => {
    // Use sendBeacon or just trigger - can't await in beforeunload
    createBackup('auto').then(data => {
      localStorage.setItem('lastAutoBackup', JSON.stringify(data));
    });
  });
}
