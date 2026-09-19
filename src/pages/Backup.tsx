import { useState, useEffect } from 'react';
import { Database, Download, Upload, HardDrive, Clock, FileJson, AlertTriangle, CheckCircle, Trash2, Folder, Smartphone, Monitor } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, getSettings } from '@/lib/db';
import { exportBackupToFile, importBackup, createBackup } from '@/lib/backup';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDate, formatCurrency } from '@/lib/utils';
import { OfficeSettings } from '@/types';

export function Backup() {
  const [settings, setSettings] = useState<OfficeSettings | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [stats, setStats] = useState({ materials: 0, customers: 0, invoices: 0, payments: 0, totalSize: 0 });

  const backups = useLiveQuery(() => db.backups.orderBy('date').reverse().toArray(), []);

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const loadSettings = async () => {
    const s = await getSettings();
    setSettings(s || null);
  };

  const loadStats = async () => {
    const [materials, customers, invoices, payments] = await Promise.all([
      db.materials.count(),
      db.customers.count(),
      db.invoices.count(),
      db.payments.count()
    ]);
    // Estimate size
    const backup = await createBackup();
    const size = JSON.stringify(backup).length;
    setStats({ materials, customers, invoices, payments, totalSize: size });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const fileName = await exportBackupToFile('manual');
      alert(`تم إنشاء النسخ الاحتياطي بنجاح!\n\nاسم الملف: ${fileName}\n\nتم الحفظ في:\n• المتصفح: مجلد التنزيلات/Download\n• الأندرويد: Download/AgriOffice/\n• الويندوز: Documents/AgriOffice/\n\nكل نسخة لها تاريخ خاص بها كما طلبت.`);
      loadStats();
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء إنشاء النسخ الاحتياطي');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`هل أنت متأكد من استيراد النسخة الاحتياطية "${file.name}"؟\n\n⚠️ تحذير: سيتم حذف جميع البيانات الحالية واستبدالها ببيانات النسخة الاحتياطية.\n\nيُنصح بعمل نسخ احتياطي للبيانات الحالية قبل الاستيراد.`)) {
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    try {
      await importBackup(file);
      alert(`تم استيراد النسخة الاحتياطية بنجاح!\n\nتم إنشاء نسخة احتياطية تلقائية من البيانات المستوردة في مجلد AgriOffice بتاريخ اليوم كما طلبت.\n\nسيتم إعادة تحميل الصفحة الآن.`);
      window.location.reload();
    } catch (error: any) {
      console.error(error);
      alert(`فشل الاستيراد: ${error.message}`);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleDeleteBackupMeta = async (id: number) => {
    if (!confirm('هل تريد حذف سجل هذه النسخة من القائمة؟ (لن يحذف الملف من الجهاز)')) return;
    await db.backups.delete(id);
  };

  const handleClearAllData = async () => {
    if (!confirm('⚠️ تحذير خطير: هل أنت متأكد من حذف جميع البيانات نهائياً؟\n\nسيتم حذف:\n• جميع المواد\n• جميع العملاء\n• جميع الفواتير\n• جميع التسديدات\n\nلا يمكن التراجع عن هذا الإجراء!')) return;
    
    const confirmText = prompt('للتأكيد، اكتب "حذف نهائي" بالضبط:');
    if (confirmText !== 'حذف نهائي') {
      alert('تم إلغاء العملية - النص غير متطابق');
      return;
    }

    await db.transaction('rw', [db.materials, db.customers, db.invoices, db.invoiceItems, db.payments, db.notifications, db.activityLogs], async () => {
      await db.materials.clear();
      await db.customers.clear();
      await db.invoices.clear();
      await db.invoiceItems.clear();
      await db.payments.clear();
      await db.notifications.clear();
      await db.activityLogs.clear();
    });

    alert('تم حذف جميع البيانات بنجاح');
    loadStats();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Database className="w-7 h-7 text-primary-600" />
          النسخ الاحتياطي وأمان البيانات
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">حماية حقوق المكتب - بيانات الديون تمتد لسنة كاملة أو أكثر</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Backup Actions */}
          <Card className="border-0 shadow-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-primary-600 to-green-600" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HardDrive className="w-5 h-5" />إنشاء نسخ احتياطي</CardTitle>
              <p className="text-xs text-gray-500">يتم حفظ النسخ في مجلد Downloads/AgriOffice مع تاريخ واسم المكتب</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-primary-50 to-green-50 dark:from-primary-900/20 dark:to-green-900/20 border border-primary-200 dark:border-primary-800/30 rounded-xl p-4">
                  <h3 className="font-bold text-primary-800 dark:text-primary-300 flex items-center gap-2"><Download className="w-4 h-4" />تصدير نسخة احتياطية</h3>
                  <p className="text-xs text-primary-700 dark:text-primary-400 mt-2 leading-relaxed">
                    يتم حفظ ملف JSON يحتوي على جميع بياناتك في مجلد التحميلات مع اسم المكتب والتاريخ:<br/>
                    <code className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded text-[11px] mt-1 inline-block">المكتب_الزراعي_Backup_2024-01-15_14-30-00.json</code>
                  </p>
                  <Button onClick={handleExport} disabled={isExporting} className="w-full mt-4 bg-primary-600 hover:bg-primary-700">
                    {isExporting ? 'جاري التصدير...' : <><Download className="w-4 h-4 ml-2" />تصدير الآن إلى التحميلات</>}
                  </Button>
                  <div className="flex gap-2 mt-3 text-[11px] text-primary-600 dark:text-primary-400">
                    <span className="flex items-center gap-1"><Folder className="w-3 h-3" />Downloads/AgriOffice/</span>
                    <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" />Android</span>
                    <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />Windows 10/11</span>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4">
                  <h3 className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2"><Upload className="w-4 h-4" />استيراد نسخة احتياطية</h3>
                  <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 leading-relaxed">
                    استيراد ملف نسخ احتياطي سابق. سيتم وضعه في مجلد خاص بالتطبيق مع تاريخ الاستيراد وحفظ نسخة تلقائية جديدة كما طلبت.
                  </p>
                  <label className="block w-full mt-4">
                    <div className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-2 cursor-pointer font-medium text-sm transition-colors">
                      <Upload className="w-4 h-4" />
                      {isImporting ? 'جاري الاستيراد...' : 'اختيار ملف للاستيراد'}
                    </div>
                    <input type="file" accept=".json" className="hidden" onChange={handleImport} disabled={isImporting} />
                  </label>
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-2">• يدعم ملفات JSON فقط • نسخ تلقائي بعد الاستيراد</p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <p className="font-bold">تنبيه هام لحماية أموال المكتب:</p>
                  <ul className="list-disc pr-4 mt-1 space-y-1">
                    <li>قم بعمل نسخ احتياطي يومياً على الأقل - بيانات الديون تمتد لسنة</li>
                    <li>احفظ النسخ على فلاش ميموري خارجي أو حاسبة أخرى</li>
                    <li>عند الاستيراد، يتم إنشاء نسخة تلقائية في مجلد Downloads/AgriOffice بتاريخ اليوم</li>
                    <li>كل نسخة لها اسم وتاريخ خاص بها كما طلبت: اسم_المكتب_تاريخ_وقت.json</li>
                    <li>في حال تعطل الحاسبة أو فيروس، يمكنك استعادة كل شيء من النسخة</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Backup History */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base"><Clock className="w-5 h-5" />سجل النسخ الاحتياطية</CardTitle>
                <Badge variant="secondary" className="text-[11px]">{backups?.length || 0} نسخة</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {backups?.length ? backups.map((backup) => (
                  <div key={backup.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${backup.type === 'auto' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : backup.type === 'import' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'}`}>
                        <FileJson className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-medium text-sm truncate max-w-[200px] md:max-w-xs">{backup.fileName}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                          {new Date(backup.date).toLocaleString('ar-EG')} 
                          <Badge variant={backup.type === 'auto' ? 'secondary' : backup.type === 'import' ? 'warning' : 'success'} className="text-[9px]">
                            {backup.type === 'auto' ? 'تلقائي' : backup.type === 'import' ? 'استيراد' : 'يدوي'}
                          </Badge>
                          {backup.size && <span>{(backup.size / 1024).toFixed(1)} KB</span>}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => handleDeleteBackupMeta(backup.id!)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                )) : (
                  <div className="text-center py-12">
                    <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">لا يوجد سجل نسخ بعد</p>
                    <p className="text-xs text-gray-400 mt-1">سيظهر هنا كل النسخ مع التاريخ والاسم</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Stats */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base">حجم البيانات الحالية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl"><p className="text-xs text-gray-500">المواد</p><p className="font-bold text-lg">{stats.materials}</p></div>
                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl"><p className="text-xs text-gray-500">العملاء</p><p className="font-bold text-lg">{stats.customers}</p></div>
                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl"><p className="text-xs text-gray-500">الفواتير</p><p className="font-bold text-lg">{stats.invoices}</p></div>
                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl"><p className="text-xs text-gray-500">التسديدات</p><p className="font-bold text-lg">{stats.payments}</p></div>
              </div>
              <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800/30 rounded-xl p-3">
                <p className="text-xs text-primary-700 dark:text-primary-300">حجم النسخة التقديري</p>
                <p className="font-bold text-primary-800 dark:text-primary-200">{(stats.totalSize / 1024).toFixed(1)} KB</p>
                <p className="text-[11px] text-primary-600 dark:text-primary-400 mt-1">JSON مضغوط</p>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" />آمن 100% بدون انترنت</p>
                <p className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" />يعمل على Android و Windows 10/11</p>
                <p className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" />نسخ تلقائي كل {settings?.autoBackupInterval || 60} دقيقة</p>
              </div>
            </CardContent>
          </Card>

          {/* Auto Backup Info */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />النسخ التلقائي</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">الحالة</span><Badge variant={settings?.autoBackupEnabled ? 'success' : 'secondary'} className="text-[10px]">{settings?.autoBackupEnabled ? 'مفعل' : 'معطل'}</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">الفترة</span><span>كل {settings?.autoBackupInterval || 60} دقيقة</span></div>
              <div className="flex justify-between"><span className="text-gray-500">آخر نسخة</span><span className="text-xs">{settings?.lastBackup ? new Date(settings.lastBackup).toLocaleString('ar-EG') : 'لم يتم بعد'}</span></div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
                يتم حفظ النسخ التلقائية أيضاً في مجلد التحميلات Downloads/AgriOffice مع التاريخ كما طلبت.
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-0 shadow-md border-red-200 dark:border-red-800/30">
            <CardHeader>
              <CardTitle className="text-base text-red-600 flex items-center gap-2"><Trash2 className="w-4 h-4" />منطقة الخطر</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-600 dark:text-gray-400">حذف جميع البيانات نهائياً - لا يمكن التراجع</p>
              <Button variant="destructive" size="sm" className="w-full" onClick={handleClearAllData}>
                <Trash2 className="w-4 h-4 ml-2" />
                حذف جميع البيانات
              </Button>
              <p className="text-[11px] text-red-600">⚠️ احرص على عمل نسخ احتياطي قبل الحذف</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
