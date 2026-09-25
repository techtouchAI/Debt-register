import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Download, Upload, HardDrive, Clock, FileJson, AlertTriangle, CheckCircle, Trash2, Folder, RotateCcw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, refreshSettings } from '@/lib/db';
import {
  exportBackupToFile,
  importInspectedBackup,
  inspectBackupFile,
  listSnapshots,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot
} from '@/lib/backup';
import { confirmDialog } from '@/lib/confirm';
import { formatFileSize } from '@/lib/labels';
import { getElectronAPI, isNativePlatform, isTauri } from '@/lib/platform';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDate } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { useAsyncScope } from '@/hooks/useAsyncScope';
import type { BackupSnapshot, OfficeSettings } from '@/types';

export function Backup() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  /* نطاق يُلغى عند مغادرة الشاشة: يمنع متابعة عمليات النسخ/الاستعادة على
     قاعدة بيانات أُغلقت، ويوقف مؤقت إعادة التحميل المعلّق. */
  const scope = useAsyncScope();
  const reloadTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    };
  }, []);

  /**
   * إعادة تحميل مؤجلة بعد عمليات الاستيراد/الاستعادة/الحذف الكامل.
   * تُلغى إذا غادر المستخدم الشاشة قبل انتهاء المهلة بدل أن تُعيد تحميل
   * الصفحة أثناء عمل شيء آخر.
   */
  const scheduleReload = useCallback(
    (delay: number) => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null;
        if (scope.aborted) return;
        window.location.reload();
      }, delay);
    },
    [scope]
  );

  /** أين يُحفظ ملف التصدير على المنصة الحالية (وصف دقيق بالعربية). */
  const saveLocationHint = isNativePlatform()
    ? 'أندرويد: يُحفظ في المستندات ← إدارة المكتب ← النسخ الاحتياطية، ثم تفتح نافذة المشاركة لحفظ نسخة في مكان آخر أو إرسالها'
    : getElectronAPI() || isTauri()
      ? 'ويندوز: يفتح صندوق الحفظ لتختار المكان (المقترح: التنزيلات ← إدارة المكتب)'
      : 'المتصفح: يُحفظ في مجلد التنزيلات';

  const backups = useLiveQuery(() => db.backups.orderBy('date').reverse().toArray(), []);
  const snapshots = useLiveQuery(() => listSnapshots(), []);

  /**
   * كل ما يعرضه هذا القسم يُقرأ عبر استعلامات حيّة مباشِرة من قاعدة
   * البيانات بدل تحميل يدوي داخل تأثير مع حالة محلية:
   *   - الأرقام تتحدّث تلقائياً بعد الاستيراد أو الاستعادة أو الحذف الكامل.
   *   - لا تحديثات حالة متزامنة داخل تأثير (لا رسوم متتالية ولا نتائج قديمة).
   */
  const settings = (useLiveQuery(() => getSettings(), []) ?? null) as OfficeSettings | null;

  const stats = useLiveQuery(async () => {
    const [materials, customers, invoices, payments, customerLedger, stockMovements, invoiceItems] = await Promise.all([
      db.materials.count(),
      db.customers.count(),
      db.invoices.count(),
      db.payments.count(),
      db.customerLedger.count(),
      db.stockMovements.count(),
      db.invoiceItems.count()
    ]);
    // تقدير الحجم من عدد السجلات بدل تصدير القاعدة كاملة في كل فتح للصفحة
    const estimatedRows = materials + customers + invoices + payments + customerLedger + stockMovements + invoiceItems;
    let totalSize = estimatedRows * 220;
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage) totalSize = estimate.usage;
    } catch {
      /* التقدير غير مدعوم — نستخدم الحساب التقريبي */
    }
    return { materials, customers, invoices, payments, customerLedger, stockMovements, totalSize };
  }, []) ?? { materials: 0, customers: 0, invoices: 0, payments: 0, customerLedger: 0, stockMovements: 0, totalSize: 0 };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exported = await scope.run(() => exportBackupToFile('manual'));
      if (scope.aborted) return; // غادر المستخدم الشاشة: لا رسائل ولا تحديث حجم
      // لا حاجة لتحديث يدوي للأرقام: استعلام الحجم حيّ ويُحدَّث تلقائياً
      toast.success('تم إنشاء النسخة الاحتياطية', exported.message);
    } catch (error) {
      if (error instanceof Error && error.message === 'BACKUP_CANCELLED') {
        toast.info('أُلغي الحفظ', 'لم يتم اختيار مكان للحفظ');
      } else {
        reportError('Backup.export', error, 'حدث خطأ أثناء إنشاء النسخ الاحتياطي');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleCreateSnapshot = async () => {
    try {
      const snapshot = await saveSnapshot('manual');
      toast.success(
        snapshot ? 'تم إنشاء نسخة داخلية' : 'لا توجد تغييرات',
        snapshot ? 'يمكن استعادتها من قائمة النسخ الداخلية' : 'البيانات لم تتغير منذ آخر نسخة'
      );
    } catch (error) {
      reportError('Backup.snapshot', error, 'تعذّر إنشاء نسخة داخلية');
    }
  };

  /**
   * الاستيراد على مرحلتين: فحص الملف أولاً (بنيته وبصمة سلامته وأعداد
   * سجلاته) وعرض ملخصه في حوار التأكيد، ثم الاستبدال بعد موافقة صريحة.
   * يعمل من زر اختيار الملف ومن سحب الملف وإفلاته (ويندوز بالفأرة).
   */
  const importFromFile = async (file: File) => {
    if (isImporting) return;
    setIsImporting(true);
    try {
      const inspected = await scope.run(() => inspectBackupFile(file));
      if (scope.aborted) return;
      const { preview } = inspected;
      const counts = preview.counts;
      const confirmed = await confirmDialog({
        title: 'استيراد النسخة الاحتياطية؟',
        message: `الملف: ${file.name}\nسيتم استبدال جميع البيانات الحالية ببيانات هذه النسخة. يُنصح بتصدير نسخة من البيانات الحالية قبل المتابعة.`,
        details: [
          `المكتب: ${preview.officeName || 'غير محدد'}`,
          `تاريخ النسخة: ${formatDate(preview.date, true)}`,
          `${counts.invoices ?? 0} فاتورة • ${counts.customers ?? 0} زبون • ${counts.materials ?? 0} مادة`,
          `${counts.payments ?? 0} تسديد • ${counts.customerLedger ?? 0} حركة ذمم • ${counts.stockMovements ?? 0} حركة مخزون`,
          ...preview.warnings.slice(0, 3)
        ],
        confirmText: 'استيراد واستبدال البيانات',
        tone: 'warning'
      });
      if (!confirmed || scope.aborted) return;

      const result = await scope.run(() => importInspectedBackup(file, inspected.backup, inspected.warnings));
      if (scope.aborted) return;
      toast.success(
        'تم الاستيراد بنجاح',
        `${result.counts.invoices} فاتورة • ${result.counts.customers} زبون • ${result.counts.payments} تسديد • ${result.counts.stockMovements} حركة مخزون`
      );
      if (result.warnings.length) toast.warning('تنبيهات أثناء الاستيراد', result.warnings.slice(0, 3).join(' | '));
      scheduleReload(1200);
    } catch (error) {
      reportError('Backup.import', error, 'فشل الاستيراد');
    } finally {
      if (!scope.aborted) setIsImporting(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // تفريغ الحقل فوراً: اختيار الملف نفسه مرة أخرى يُطلق الحدث من جديد
    e.target.value = '';
    if (file) void importFromFile(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      toast.warning('ملف غير مدعوم', 'أفلت ملف نسخة احتياطية صادراً من هذا التطبيق');
      return;
    }
    void importFromFile(file);
  };

  const handleRestoreSnapshot = async (snapshot: Omit<BackupSnapshot, 'payload'>) => {
    const snapshotId = snapshot.id;
    if (!snapshotId) return;
    const confirmed = await confirmDialog({
      title: 'استعادة النسخة الداخلية؟',
      message: `سيتم استبدال البيانات الحالية بنسخة ${formatDate(snapshot.date, true)}.`,
      confirmText: 'استعادة',
      tone: 'warning'
    });
    if (!confirmed) return;

    setIsRestoring(snapshotId);
    try {
      const result = await scope.run(() => restoreSnapshot(snapshotId));
      if (scope.aborted) return;
      toast.success('تمت الاستعادة', `${result.counts.invoices} فاتورة • ${result.counts.payments} تسديد`);
      scheduleReload(1200);
    } catch (error) {
      reportError('Backup.restore', error, 'فشلت الاستعادة');
    } finally {
      setIsRestoring(null);
    }
  };

  const handleDeleteSnapshot = async (id: number) => {
    const confirmed = await confirmDialog({ title: 'حذف هذه النسخة الداخلية؟', confirmText: 'حذف', tone: 'danger' });
    if (!confirmed) return;
    try {
      await deleteSnapshot(id);
      toast.success('تم حذف النسخة الداخلية');
    } catch (error) {
      reportError('Backup.snapshot.delete', error, 'تعذّر حذف النسخة');
    }
  };

  const handleDeleteBackupMeta = async (id: number) => {
    const confirmed = await confirmDialog({
      title: 'حذف السجل من القائمة؟',
      message: 'يُحذف السطر من سجل النسخ فقط، ولا يُحذف الملف من الجهاز.',
      confirmText: 'حذف السجل',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await db.backups.delete(id);
    } catch (error) {
      reportError('Backup.meta.delete', error, 'تعذّر حذف السجل');
    }
  };

  const handleClearAllData = async () => {
    // حوار داخل التطبيق يطلب كتابة "حذف نهائي": كان `prompt()` الأصلي غير
    // مدعوم في نسخة ويندوز فيفشل الحذف دائماً هناك.
    const confirmed = await confirmDialog({
      title: 'حذف جميع بيانات التطبيق نهائياً؟',
      message: 'سيبدأ التطبيق من جديد بمعالج إعداد المكتب، ولا يمكن التراجع عن هذا الإجراء.',
      details: [
        'الإعدادات والمستخدمون',
        'جميع المواد والعملاء',
        'جميع الفواتير والتسديدات ودفتر الذمم وحركات المخزون',
        'الإشعارات وسجل النشاط',
        'سجل النسخ والنسخ الداخلية'
      ],
      confirmText: 'حذف نهائي',
      tone: 'danger',
      requireText: 'حذف نهائي'
    });
    if (!confirmed) return;

    try {
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
          db.customerLedger,
          db.stockMovements,
          db.notifications,
          db.activityLogs,
          db.backups,
          db.snapshots,
          db.meta
        ],
        async () => {
          await db.settings.clear();
          await db.users.clear();
          await db.materials.clear();
          await db.customers.clear();
          await db.invoices.clear();
          await db.invoiceItems.clear();
          await db.payments.clear();
          await db.customerLedger.clear();
          await db.stockMovements.clear();
          await db.notifications.clear();
          await db.activityLogs.clear();
          await db.backups.clear();
          await db.snapshots.clear();
          await db.meta.clear();
        }
      );
      await refreshSettings(); // المخزن المشترك يعود فارغاً ⇒ يظهر معالج الإعداد
      toast.success('تم حذف جميع بيانات التطبيق', 'سيُعاد تشغيل معالج إعداد المكتب');
      scheduleReload(600);
    } catch (error) {
      reportError('Backup.clear', error, 'تعذّر حذف البيانات');
    }
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
            <div className="h-1 bg-gradient-to-r from-primary-600 to-primary-400" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HardDrive className="w-5 h-5" />إنشاء نسخ احتياطي</CardTitle>
              <p className="text-xs text-gray-500">التصدير اليدوي يحفظ ملفاً واحداً فيه كل بيانات المكتب باسم المكتب والتاريخ</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-100/70 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/60 rounded-xl p-4">
                  <h3 className="font-bold text-primary-800 dark:text-primary-300 flex items-center gap-2"><Download className="w-4 h-4" />تصدير نسخة احتياطية</h3>
                  <p className="text-xs text-primary-700 dark:text-primary-400 mt-2 leading-relaxed">
                    ملف واحد يضم كل شيء: بيانات المكتب والشعار والإعدادات، المستخدمين، المواد، الزبائن، الفواتير، التسديدات، دفتر ذمم العملاء، حركات المخزون، الإشعارات وسجل النشاط وتسلسل أرقام المستندات. اسم الملف:<br/>
                    <span className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded text-[11px] mt-1 inline-block break-all">اسم_المكتب_نسخة_احتياطية_التاريخ_الوقت</span>
                  </p>
                  <Button onClick={handleExport} disabled={isExporting} className="w-full mt-4 bg-primary-600 hover:bg-primary-700">
                    {isExporting ? 'جاري التصدير...' : <><Download className="w-4 h-4 ml-2" />تصدير الآن</>}
                  </Button>
                  <p className="flex items-start gap-1.5 mt-3 text-[11px] text-primary-600 dark:text-primary-400 leading-relaxed">
                    <Folder className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    {saveLocationHint}
                  </p>
                </div>

                <div
                  className={`border rounded-xl p-4 transition-colors ${isDragging ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500 border-dashed' : 'bg-gray-100/70 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/60'}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    if (!isDragging) setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <h3 className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2"><Upload className="w-4 h-4" />استيراد نسخة احتياطية</h3>
                  <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 leading-relaxed">
                    يُفحص الملف أولاً ويُعرض ملخصه (اسم المكتب والتاريخ وعدد السجلات) قبل الاستبدال، ثم تُحفظ نسخة أمان داخلية تلقائياً.
                  </p>
                  <label className="block w-full mt-4">
                    <div className="w-full h-11 bg-primary-600 hover:bg-primary-700 text-white rounded-lg flex items-center justify-center gap-2 cursor-pointer font-medium text-sm transition-colors">
                      {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {isImporting ? 'جاري الاستيراد...' : 'اختيار ملف للاستيراد'}
                    </div>
                    <input type="file" accept=".json,application/json" className="hidden" onChange={handleImport} disabled={isImporting} />
                  </label>
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-2">
                    • ملفات النسخ الصادرة من هذا التطبيق فقط • يمكنك أيضاً سحب الملف وإفلاته هنا
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <p className="font-bold">تنبيه هام لحماية أموال المكتب:</p>
                  <ul className="list-disc pr-4 mt-1 space-y-1">
                    <li>قم بعمل نسخ احتياطي يومياً على الأقل - بيانات الديون تمتد لسنة</li>
                    <li>احفظ النسخ على فلاش ميموري خارجي أو حاسبة أخرى</li>
                    <li>عند الاستيراد تُنشأ نسخة أمان داخلية تلقائياً يمكن الرجوع إليها</li>
                    <li>كل نسخة لها اسم وتاريخ خاص بها: اسم المكتب ثم التاريخ والوقت</li>
                    <li>في حال تعطل الحاسبة أو فيروس، يمكنك استعادة كل شيء من النسخة</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Internal snapshots */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <HardDrive className="w-5 h-5" />النسخ الداخلية (تلقائية)
                </CardTitle>
                <Badge variant="secondary" className="text-[11px]">{snapshots?.length || 0} نسخة</Badge>
              </div>
              <p className="text-xs text-gray-500">
                تُحفظ داخل التطبيق كل فترة دون تنزيل ملفات، ويمكن استعادتها بضغطة واحدة. آخر 5 نسخ فقط.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" size="sm" className="w-full" onClick={handleCreateSnapshot}>
                <Download className="w-4 h-4 ml-2" />إنشاء نسخة داخلية الآن
              </Button>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {snapshots?.length ? snapshots.map((snapshot) => (
                  <div key={snapshot.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <Database className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{formatDate(snapshot.date, true)}</p>
                        <p className="text-[11px] text-gray-500">
                          {formatFileSize(snapshot.size)} • {snapshot.type === 'auto' ? 'تلقائية' : 'يدوية'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[11px]"
                        disabled={isRestoring !== null}
                        onClick={() => handleRestoreSnapshot(snapshot)}
                      >
                        {isRestoring === snapshot.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 ml-1" />}
                        استعادة
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => snapshot.id && handleDeleteSnapshot(snapshot.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )) : (
                  <p className="text-center text-sm text-gray-500 py-8">لا توجد نسخ داخلية بعد</p>
                )}
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
                        <p
                          className="font-medium text-sm break-all max-w-[220px] md:max-w-xs leading-snug"
                          title={backup.fileName}
                        >
                          {backup.fileName}
                        </p>
                        {/* div لا p: الشارة عنصر div، ووضعها داخل p يُنتج HTML غير صالح
                            ويجعل المتصفح يعيد ترتيب الشجرة (تحذير React DOM nesting) */}
                        <div className="text-xs text-gray-500 flex items-center gap-2">
                          {new Date(backup.date).toLocaleString('ar-EG')}
                          <Badge variant={backup.type === 'auto' ? 'secondary' : backup.type === 'import' ? 'warning' : 'success'} className="text-[9px]">
                            {backup.type === 'auto' ? 'تلقائي' : backup.type === 'import' ? 'استيراد' : 'يدوي'}
                          </Badge>
                          {backup.size ? <span>{formatFileSize(backup.size)}</span> : null}
                        </div>
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
                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl"><p className="text-xs text-gray-500">حركات المخزون</p><p className="font-bold text-lg">{stats.stockMovements}</p></div>
              </div>
              <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800/30 rounded-xl p-3">
                <p className="text-xs text-primary-700 dark:text-primary-300">حجم البيانات التقديري</p>
                <p className="font-bold text-primary-800 dark:text-primary-200">{formatFileSize(stats.totalSize)}</p>
                <p className="text-[11px] text-primary-600 dark:text-primary-400 mt-1">محفوظة على هذا الجهاز فقط</p>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" />آمن 100% بدون انترنت</p>
                <p className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" />يعمل على أندرويد وويندوز 10 و 11</p>
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
                النسخ التلقائية تُحفظ داخل التطبيق (النسخ الداخلية) حتى لا يتكرر تنزيل الملفات أو فتح صندوق الحفظ أثناء العمل.
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
