#!/usr/bin/env node
/**
 * تجهيز مشروع أندرويد بعد `npx cap add android` (سكربت متكرر idempotent).
 *
 * Capacitor يولّد المشروع بقوالب عامة، وبعض ما يحتاجه هذا التطبيق فعلياً لا
 * يأتي معه:
 *   - صلاحيات الإشعارات والتخزين الخارجي (نسخ احتياطي/مشاركة ملفات) — ولهذا
 *     يُقرأ المانيفست ويُعدَّل، مع إضافة الوسوم مرة واحدة فقط.
 *   - منع حركة النص الصريح (usesCleartextTraffic=false) على مستوى التطبيق.
 *   - أيقونة صغيرة أحادية اللون للإشعارات (قناة `ic_stat_agri`) بدل أيقونة
 *     التطبيق الملونة التي تظهر كمربع أبيض في شريط الحالة.
 *   - مزامنة اسم التطبيق في strings.xml مع capacitor.config.json **دون تكرار
 *     الوسم** (تكرار `app_name` يُفشل `MergeResources` في Gradle: Found item
 *     String/app_name more than one time).
 *
 * التشغيل المتكرر آمن: لا يُكرر أي وسم ولا يستبدل شيئاً موجوداً إلا القيم
 * المقصودة. الدوال مُصدَّرة لتُختبر مباشرة على مشروع مؤقت في `tests/`.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NOTIFICATION_ICON = 'ic_stat_agri';

/** تعبير وسم app_name مهما كان ترتيب سماته. */
const APP_NAME_TAG = /<string\s+name="app_name"[^>]*>[\s\S]*?<\/string>/g;

/** الصلاحيات المطلوبة مع سبب كل واحدة (تُطبع في السجل للتشخيص). */
export const PERMISSIONS = [
  {
    name: 'android.permission.POST_NOTIFICATIONS',
    extra: '',
    reason: 'إشعارات التنبيه بالديون ونقص المخزون (أندرويد 13+)'
  },
  {
    name: 'android.permission.READ_EXTERNAL_STORAGE',
    extra: ' android:maxSdkVersion="32"',
    reason: 'قراءة ملف النسخة الاحتياطية للاستيراد على أندرويد 12 وأقدم'
  },
  {
    name: 'android.permission.WRITE_EXTERNAL_STORAGE',
    extra: ' android:maxSdkVersion="29"',
    reason: 'حفظ ملفات PDF/النسخ في مجلد التنزيلات على الأجهزة القديمة'
  },
  {
    name: 'android.permission.SCHEDULE_EXACT_ALARM',
    extra: ' android:maxSdkVersion="32"',
    reason: 'جدولة الإشعارات المحلية بدقة في النسخ القديمة (لا يُطلب على 13+)'
  }
];

/** مصدر الحقيقة الوحيد لأيقونة الإشعارات (يُستنسخ إلى مشروع أندرويد). */
export const NOTIFICATION_ICON_SOURCE = 'resources/android/ic_stat_agri.xml';

/** تهريب محارف XML في القيم التي نكتبها (اسم التطبيق من الإعداد). */
function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** التحقق من إعداد Capacitor (يُستخدم أيضاً في التدقيق الثابت). */
export function validateCapacitorConfig(config) {
  const smallIcon = config?.plugins?.LocalNotifications?.smallIcon;
  if (smallIcon !== NOTIFICATION_ICON) {
    throw new Error(
      `smallIcon في capacitor.config.json يجب أن يكون "${NOTIFICATION_ICON}" (المطلوب فعلياً: ${String(smallIcon)})`
    );
  }
  if (config.plugins.LocalNotifications.sound) {
    throw new Error('لا تُستخدم قيمة sound في إعداد الإشعارات: لا يوجد ملف صوت مرفق، فيُستخدم نغمة النظام');
  }
  const iconColor = config.plugins.LocalNotifications.iconColor;
  if (iconColor && !/^#[0-9a-f]{6}$/i.test(iconColor)) {
    throw new Error('iconColor يجب أن يكون بصيغة #RRGGBB');
  }
  if (config.android?.allowMixedContent !== false) {
    throw new Error('allowMixedContent يجب أن يكون false');
  }
  if (!config.appName || !String(config.appName).trim()) {
    throw new Error('appName مطلوب في capacitor.config.json');
  }
  return { appName: String(config.appName).trim() };
}

/**
 * يزامن `app_name` في strings.xml مع إعداد التطبيق.
 *  - لا يوجد الوسم ⇒ يُضاف مرة واحدة قبل `</resources>`.
 *  - يوجد أكثر من نسخة (مشروع مُجهَّز بنسخة أقدم من السكربت) ⇒ يُدمج في نسخة
 *    واحدة؛ تكرار الوسم يُفشل بناء Gradle.
 */
export function syncAppName(stringsXml, appName) {
  const wanted = `<string name="app_name">${escapeXml(appName)}</string>`;
  const occurrences = stringsXml.match(APP_NAME_TAG)?.length ?? 0;

  if (occurrences === 0) {
    if (!stringsXml.includes('</resources>')) {
      throw new Error('ملف strings.xml غير مكتمل (لا يوجد </resources>)');
    }
    return { xml: stringsXml.replace('</resources>', `    ${wanted}\n</resources>`), added: true, duplicates: 0 };
  }

  let first = true;
  const xml = stringsXml.replace(APP_NAME_TAG, () => {
    if (!first) return '';
    first = false;
    return wanted;
  });

  // إزالة الأسطر الفارغة الناتجة عن حذف النسخ المكررة
  const cleaned = xml.replace(/[ \t]+\n\s*\n/g, '\n');
  const remaining = cleaned.match(APP_NAME_TAG)?.length ?? 0;
  if (remaining !== 1) {
    throw new Error(`تعذّر توحيد app_name في strings.xml (بقيت ${remaining} نسخة)`);
  }
  return { xml: cleaned, added: false, duplicates: Math.max(0, occurrences - 1) };
}

/** يضيف وسم الصلاحية مرة واحدة فقط إن لم يكن موجوداً. */
export function ensurePermission(manifestXml, permission) {
  if (manifestXml.includes(`android:name="${permission.name}"`)) return { xml: manifestXml, added: false };
  if (!manifestXml.includes('</manifest>')) {
    throw new Error('ملف المانيفست غير مكتمل (لا يوجد وسم </manifest>)');
  }
  const tag = `    <uses-permission android:name="${permission.name}"${permission.extra} />`;
  return { xml: manifestXml.replace('</manifest>', `${tag}\n</manifest>`), added: true };
}

/** يفرض قيمة سمة على وسم <application> (يضيفها إن لم تكن موجودة). */
export function ensureApplicationAttribute(manifestXml, attribute, value) {
  const applicationMatch = manifestXml.match(/<application[\s\S]*?>/);
  if (!applicationMatch) throw new Error('لم يُعثر على وسم <application> في المانيفست');

  const pattern = new RegExp(`${attribute}="[^"]*"`);
  let tag = applicationMatch[0];
  if (pattern.test(tag)) {
    tag = tag.replace(pattern, `${attribute}="${value}"`);
  } else {
    tag = tag.replace(/<application/, `<application\n        ${attribute}="${value}"`);
  }
  return manifestXml.replace(applicationMatch[0], tag);
}

/**
 * التجهيز الكامل لمشروع أندرويد الموجود في `root/android`.
 * يُعيد ملخّص ما حدث (يُستخدم في الاختبارات والسجل).
 */
export async function prepareAndroid({ root = repoRoot, log = () => undefined } = {}) {
  const androidDir = join(root, 'android');
  const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml');
  const stringsPath = join(androidDir, 'app/src/main/res/values/strings.xml');
  const drawableDir = join(androidDir, 'app/src/main/res/drawable');

  if (!existsSync(androidDir)) {
    throw new Error('مجلد android غير موجود. شغّل: npx cap add android ثم npx cap sync');
  }
  if (!existsSync(manifestPath)) throw new Error(`لم يُعثر على ${manifestPath}. شغّل أولاً: npx cap add android`);
  if (!existsSync(stringsPath)) throw new Error('لم يُعثر على res/values/strings.xml');

  /* 1) المانيفست: صلاحيات + منع النص الصريح + السماح بالنسخ الاحتياطي */
  let manifest = await readFile(manifestPath, 'utf8');
  const addedPermissions = [];
  const existingPermissions = [];
  for (const permission of PERMISSIONS) {
    const result = ensurePermission(manifest, permission);
    manifest = result.xml;
    if (result.added) addedPermissions.push(permission.name);
    else existingPermissions.push(permission.name);
  }
  manifest = ensureApplicationAttribute(manifest, 'android:usesCleartextTraffic', 'false');
  manifest = ensureApplicationAttribute(manifest, 'android:allowBackup', 'true');
  await writeFile(manifestPath, manifest, 'utf8');
  for (const name of addedPermissions) log(`أُضيفت صلاحية: ${name}`);
  log(
    `المانيفست جاهز: أُضيفت ${addedPermissions.length} صلاحية، موجودة مسبقاً ${existingPermissions.length}، ومنع النص الصريح مفروض`
  );

  /* 2) أيقونة الإشعارات: تُنسخ من أصل المستودع (مصدر واحد للحقيقة) */
  const iconSourcePath = join(root, NOTIFICATION_ICON_SOURCE);
  if (!existsSync(iconSourcePath)) {
    throw new Error(`لم يُعثر على أصل أيقونة الإشعارات: ${NOTIFICATION_ICON_SOURCE}`);
  }
  const iconSource = await readFile(iconSourcePath, 'utf8');
  await mkdir(drawableDir, { recursive: true });
  const iconPath = join(drawableDir, `${NOTIFICATION_ICON}.xml`);
  const previousIcon = existsSync(iconPath) ? await readFile(iconPath, 'utf8') : null;
  const iconWritten = previousIcon !== iconSource;
  if (iconWritten) await writeFile(iconPath, iconSource, 'utf8');
  log(
    iconWritten
      ? `كُتبت أيقونة الإشعارات: drawable/${NOTIFICATION_ICON}.xml`
      : `أيقونة الإشعارات موجودة ومطابقة: drawable/${NOTIFICATION_ICON}.xml`
  );

  /* 3) اسم التطبيق في strings.xml + التحقق من إعداد Capacitor */
  const config = JSON.parse(await readFile(join(root, 'capacitor.config.json'), 'utf8'));
  const { appName } = validateCapacitorConfig(config);

  const strings = await readFile(stringsPath, 'utf8');
  const synced = syncAppName(strings, appName);
  if (synced.added) log(`أُضيف اسم التطبيق إلى strings.xml: ${appName}`);
  if (synced.duplicates) log(`أُزيل تكرار app_name في strings.xml (${synced.duplicates} نسخة زائدة)`);
  if (synced.xml !== strings) await writeFile(stringsPath, synced.xml, 'utf8');
  log('capacitor.config.json متوافق مع الأيقونة والصلاحيات');

  return {
    appName,
    addedPermissions,
    existingPermissions,
    duplicatesRemoved: synced.duplicates,
    iconWritten
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  prepareAndroid({ log: (message) => console.log(`• ${message}`) })
    .then(() => {
      console.log('✔ مشروع أندرويد جاهز (سكربت قابل للتكرار بلا تكرار وسوم).');
    })
    .catch((error) => {
      // الرسائل المتوقعة تُطبع وحدها؛ غيرها يُطبع مع التفاصيل للتشخيص
      console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && !error.message.match(/مجلد android|لم يُعثر|يجب أن|appName|iconColor|sound|allowMixedContent|أصل أيقونة/)) {
        console.error(error);
      }
      process.exit(1);
    });
}
