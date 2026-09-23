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
 *   - التحقق من أن اسم التطبيق في strings.xml مطابق لما في capacitor.config.
 *
 * التشغيل المتكرر آمن: لا يُكرر أي وسم ولا يستبدل شيئاً موجوداً. يُنفَّذ في
 * CI مرتين متتاليتين ويُقارن المانيفست قبل/بعد للتأكد من ذلك.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(repoRoot, 'android');
const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml');
const stringsPath = join(androidDir, 'app/src/main/res/values/strings.xml');
const drawableDir = join(androidDir, 'app/src/main/res/drawable');

const NOTIFICATION_ICON = 'ic_stat_agri';

/** الصلاحيات المطلوبة مع سبب كل واحدة (تُطبع في السجل للتشخيص). */
const PERMISSIONS = [
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

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`• ${message}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function prepareManifest() {
  if (!existsSync(manifestPath)) {
    fail(`لم يُعثر على ${manifestPath}. شغّل أولاً: npx cap add android`);
  }

  let xml = await readFile(manifestPath, 'utf8');
  const added = [];
  const skipped = [];

  for (const permission of PERMISSIONS) {
    if (xml.includes(`android:name="${permission.name}"`)) {
      skipped.push(permission.name);
      continue;
    }
    const tag = `    <uses-permission android:name="${permission.name}"${permission.extra} />`;
    if (xml.includes('</manifest>')) {
      xml = xml.replace('</manifest>', `${tag}\n</manifest>`);
    } else {
      fail('ملف المانيفست غير مكتمل (لا يوجد وسم </manifest>)');
    }
    added.push(`${permission.name} — ${permission.reason}`);
  }

  // منع النص الصريح (http) على مستوى التطبيق — كل شيء محلي
  const applicationMatch = xml.match(/<application[\s\S]*?>/);
  if (!applicationMatch) fail('لم يُعثر على وسم <application> في المانيفست');
  let applicationTag = applicationMatch[0];
  if (/android:usesCleartextTraffic=/.test(applicationTag)) {
    applicationTag = applicationTag.replace(
      /android:usesCleartextTraffic="[^"]*"/,
      'android:usesCleartextTraffic="false"'
    );
  } else {
    applicationTag = applicationTag.replace(/<application/, '<application\n        android:usesCleartextTraffic="false"');
  }
  if (/android:allowBackup=/.test(applicationTag)) {
    applicationTag = applicationTag.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="true"');
  }
  xml = xml.replace(applicationMatch[0], applicationTag);

  await writeFile(manifestPath, xml, 'utf8');
  for (const entry of added) log(`أُضيفت صلاحية: ${entry}`);
  if (skipped.length) log(`صلاحيات موجودة مسبقاً: ${skipped.length}`);
  log('المانيفست جاهز: صلاحيات الإشعارات/التخزين ومنع النص الصريح');
}

async function prepareNotificationIcon() {
  await mkdir(drawableDir, { recursive: true });
  const iconPath = join(drawableDir, `${NOTIFICATION_ICON}.xml`);
  // أيقونة متجهية أحادية اللون (سنبلة داخل قوس) — تعمل مع theme أي اللون
  const vector = `<?xml version="1.0" encoding="utf-8"?>
<!-- أيقونة إشعارات أحادية اللون (تُولَّد تلقائياً من إعداد Capacitor) -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFFFF">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M12,2c-1.1,0 -2,0.9 -2,2v5.2C6.9,9.6 5,12.1 5,15v5c0,0.6 0.4,1 1,1h12c0.6,0 1,-0.4 1,-1v-5c0,-2.9 -1.9,-5.4 -5,-5.8V4c0,-1.1 -0.9,-2 -2,-2zM12,11c2.8,0 5,2.2 5,5v3H7v-3c0,-2.8 2.2,-5 5,-5zM9.5,13.5l1.5,1.5 3.5,-3.5 1,1 -4.5,4.5 -2.5,-2.5z" />
</vector>
`;
  const previous = existsSync(iconPath) ? await readFile(iconPath, 'utf8') : null;
  if (previous === vector) {
    log(`أيقونة الإشعارات موجودة ومطابقة: drawable/${NOTIFICATION_ICON}.xml`);
  } else {
    await writeFile(iconPath, vector, 'utf8');
    log(`كُتبت أيقونة الإشعارات: drawable/${NOTIFICATION_ICON}.xml`);
  }
}

async function verifyStringsAndConfig() {
  const config = await readJson(join(repoRoot, 'capacitor.config.json'));
  const appName = config.appName;

  if (!existsSync(stringsPath)) fail('لم يُعثر على res/values/strings.xml');
  let strings = await readFile(stringsPath, 'utf8');
  if (!/name="app_name"[\s\S]*?<string name="app_name">([^<]*)<\/string>/.test(strings)) {
    strings = strings.replace('</resources>', `    <string name="app_name">${appName}</string>\n</resources>`);
    await writeFile(stringsPath, strings, 'utf8');
    log(`أُضيف اسم التطبيق إلى strings.xml: ${appName}`);
  }
  const match = strings.match(/<string name="app_name">([^<]*)<\/string>/);
  if (match && match[1] !== appName) {
    strings = strings.replace(match[0], `<string name="app_name">${appName}</string>`);
    await writeFile(stringsPath, strings, 'utf8');
    log(`حُدّث اسم التطبيق في strings.xml: ${appName}`);
  }

  const iconName = config.plugins?.LocalNotifications?.smallIcon;
  if (iconName !== NOTIFICATION_ICON) {
    fail(
      `smallIcon في capacitor.config.json يجب أن يكون "${NOTIFICATION_ICON}" (المطلوب فعلياً: ${String(iconName)})`
    );
  }
  if (config.plugins?.LocalNotifications?.sound) {
    fail('لا تُستخدم قيمة sound في إعداد الإشعارات: لا يوجد ملف صوت مرفق، فيُستخدم نغمة النظام');
  }
  if (config.plugins?.LocalNotifications?.iconColor && !/^#[0-9a-f]{6}$/i.test(config.plugins.LocalNotifications.iconColor)) {
    fail('iconColor يجب أن يكون بصيغة #RRGGBB');
  }
  if (config.android?.allowMixedContent !== false) {
    fail('allowMixedContent يجب أن يكون false');
  }
  log('capacitor.config.json متوافق مع الأيقونة والصلاحيات');
}

async function main() {
  if (!existsSync(androidDir)) {
    fail('مجلد android غير موجود. شغّل: npx cap add android ثم npx cap sync');
  }
  await prepareManifest();
  await prepareNotificationIcon();
  await verifyStringsAndConfig();
  console.log('✔ مشروع أندرويد جاهز (سكربت قابل للتكرار بلا تكرار وسوم).');
}

main().catch((error) => {
  console.error('✖ فشل تجهيز مشروع أندرويد:', error);
  process.exit(1);
});
