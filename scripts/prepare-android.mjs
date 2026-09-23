#!/usr/bin/env node
/**
 * تجهيز مشروع أندرويد المولَّد (بعد `npx cap add android` و`npx cap sync`).
 *
 * لماذا هذا السكربت؟
 *   `npx cap add android` يولّد مشروع Android Studio افتراضياً من قالب
 *   Capacitor، وهذا القالب:
 *     - لا يعلن صلاحية POST_NOTIFICATIONS اللازمة للإشعارات (أندرويد 13+)،
 *     - ولا صلاحيات التخزين القديمة اللازمة لكتابة النسخ الاحتياطية في
 *       مجلد المستندات على أندرويد 9 وأقدم،
 *     - ويشير إلى أيقونة إشعارات غير موجودة في المشروع المولَّد.
 *   كانت هذه الفروق تظهر فقط عند التشغيل على جهاز حقيقي، فلا تُلتقط في
 *   الاختبارات. هنا نُطبّقها **بشكل متكرر قابل للتشغيل** (idempotent) قبل كل
 *   بناء، فيصبح فحص الصلاحيات والأيقونات خطوة آلية لا يدوية.
 *
 * يُشغَّل من جذر المشروع: `node scripts/prepare-android.mjs`
 * ويكتب فقط داخل `android/` (مجلد مولَّد وغير متعقّب في git).
 */

import { access, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const androidDir = join(root, 'android');
const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const stringsPath = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const drawableDir = join(androidDir, 'app', 'src', 'main', 'res', 'drawable');
const notificationIconSource = join(root, 'resources', 'android', 'ic_stat_agri.xml');
const launcherSource = join(root, 'public', 'pwa-512x512.png');

const NOTIFICATION_ICON_NAME = 'ic_stat_agri';
const PRODUCT_NAME = 'إدارة المكتب الزراعي';

/**
 * الصلاحيات المطلوبة فعلياً مع سبب كل واحدة.
 * ملاحظة: صلاحيات التخزين تُقيَّد بـ maxSdkVersion كما يفرضه أندرويد؛
 * فمن أندرويد 10 وما بعده يعمل التطبيق بـ Scoped Storage عبر مشاركة الملفات
 * ولا يحتاج صلاحية تخزين عامة.
 */
const REQUIRED_PERMISSIONS = [
  {
    name: 'android.permission.POST_NOTIFICATIONS',
    reason: 'إشعارات المخزون والديون (إلزامية من أندرويد 13)'
  },
  {
    name: 'android.permission.READ_EXTERNAL_STORAGE',
    maxSdkVersion: 32,
    reason: 'قراءة النسخ الاحتياطية على أندرويد 12 وأقدم'
  },
  {
    name: 'android.permission.WRITE_EXTERNAL_STORAGE',
    maxSdkVersion: 29,
    reason: 'حفظ النسخ الاحتياطية في مجلد المستندات على أندرويد 9 وأقدم'
  },
  {
    name: 'android.permission.SCHEDULE_EXACT_ALARM',
    maxSdkVersion: 32,
    reason: 'جدولة تنبيهات المخزون بدقة قبل أندرويد 13'
  }
];

/** أيقونات التطبيق: المقاسات التي يتوقعها أندرويد لكل كثافة شاشة. */
const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const changes = [];
const warnings = [];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function permissionTag({ name, maxSdkVersion }) {
  const maxSdk = maxSdkVersion ? `\n        android:maxSdkVersion="${maxSdkVersion}"` : '';
  return `    <!-- ${REQUIRED_PERMISSIONS.find((entry) => entry.name === name)?.reason ?? ''} -->\n    <uses-permission\n        android:name="${name}"${maxSdk} />`;
}

function normalizePermissionTags(xml) {
  // إزالة الوسوم الموجودة بنفس الأسماء (بأي تنسيق) لإعادة كتابتها بصيغة موحّدة
  for (const permission of REQUIRED_PERMISSIONS) {
    const pattern = new RegExp(
      `<uses-permission[^>]*android:name="${permission.name.replace(/\./g, '\\.')}"[^>]*/>`,
      'g'
    );
    xml = xml.replace(pattern, '');
  }
  return xml;
}

async function patchManifest() {
  let xml = await readFile(manifestPath, 'utf8');
  const original = xml;

  xml = normalizePermissionTags(xml);

  // إدراج الصلاحيات قبل وسم <application
  const applicationIndex = xml.indexOf('<application');
  if (applicationIndex === -1) throw new Error('لم يُعثر على وسم <application> في AndroidManifest.xml');

  const tags = REQUIRED_PERMISSIONS.map(permissionTag).join('\n');
  const needsNewline = xml[applicationIndex - 1] === '\n' ? '' : '\n';
  xml = `${xml.slice(0, applicationIndex)}${tags}${needsNewline}${xml.slice(applicationIndex)}`;

  // منع أي اتصال غير مشفّر داخل WebView
  if (/<application(?![^>]*usesCleartextTraffic)/.test(xml)) {
    xml = xml.replace(/<application/, '<application\n        android:usesCleartextTraffic="false"');
    changes.push('أُضيف android:usesCleartextTraffic="false"');
  }

  if (xml !== original) {
    await writeFile(manifestPath, xml, 'utf8');
    changes.push(`AndroidManifest.xml: ${REQUIRED_PERMISSIONS.length} صلاحيات مطلوبة`);
  } else {
    changes.push('AndroidManifest.xml: مطابق للمطلوب (لا تغيير)');
  }
}

async function writeNotificationIcon() {
  if (!(await exists(notificationIconSource))) {
    warnings.push('ملف أيقونة الإشعارات المصدري غير موجود — سيستخدم أندرويد أيقونة التطبيق');
    return;
  }
  await mkdir(drawableDir, { recursive: true });
  await copyFile(notificationIconSource, join(drawableDir, `${NOTIFICATION_ICON_NAME}.xml`));
  changes.push(`أيقونة الإشعارات: ${NOTIFICATION_ICON_NAME}.xml`);
}

/** توليد أيقونات التطبيق من شعار المشروع (يتطلب ImageMagick — اختياري). */
async function writeLauncherIcons() {
  if (!(await exists(launcherSource))) {
    warnings.push('صورة الشعار public/pwa-512x512.png غير موجودة — تُركت أيقونات القالب');
    return;
  }
  let converter = null;
  for (const candidate of ['magick', 'convert']) {
    try {
      await execFileAsync(candidate, ['-version']);
      converter = candidate;
      break;
    } catch {
      /* غير متوفر */
    }
  }
  if (!converter) {
    warnings.push('ImageMagick غير متوفر — تُركت أيقونات أندرويد الافتراضية (تحسين شكلي فقط)');
    return;
  }

  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const targetDir = join(androidDir, 'app', 'src', 'main', 'res', folder);
    await mkdir(targetDir, { recursive: true });
    const args = ['-background', 'none', '-resize', `${size}x${size}`, launcherSource];
    await execFileAsync(converter, [...args, join(targetDir, 'ic_launcher.png')]);
    await execFileAsync(converter, [...args, join(targetDir, 'ic_launcher_round.png')]);
  }
  changes.push('أيقونات التطبيق: مولَّدة من شعار المشروع لكل كثافات الشاشة');
}

async function ensureStrings() {
  if (!(await exists(stringsPath))) return;
  let xml = await readFile(stringsPath, 'utf8');
  if (!/name="app_name"/.test(xml)) return;
  const updated = xml.replace(
    /<string name="app_name">[^<]*<\/string>/,
    `<string name="app_name">${PRODUCT_NAME}</string>`
  );
  if (updated !== xml) {
    await writeFile(stringsPath, updated, 'utf8');
    changes.push('strings.xml: اسم التطبيق العربي');
  }
}

/** التأكد من تطابق اسم أيقونة الإشعارات بين إعدادات Capacitor والمشروع. */
async function verifyCapacitorConfig() {
  const configPath = join(root, 'capacitor.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const configuredIcon = config?.plugins?.LocalNotifications?.smallIcon;
  if (configuredIcon !== NOTIFICATION_ICON_NAME) {
    throw new Error(
      `capacitor.config.json يشير إلى أيقونة إشعارات "${configuredIcon}" بينما المزوَّد هو "${NOTIFICATION_ICON_NAME}"`
    );
  }
  const configuredSound = config?.plugins?.LocalNotifications?.sound;
  if (configuredSound) {
    warnings.push(
      `capacitor.config.json يحدّد ملف صوت "${configuredSound}" — تأكد من وجوده في res/raw وإلا استُخدم صوت النظام`
    );
  }
  if (config?.server?.androidScheme !== 'https') {
    throw new Error('capacitor.config.json: يجب أن يكون androidScheme = https');
  }
  if (config?.android?.allowMixedContent !== false) {
    throw new Error('capacitor.config.json: يجب تعطيل allowMixedContent');
  }
}

async function main() {
  if (!(await exists(manifestPath))) {
    console.error(
      'لم يُعثر على مشروع أندرويد. شغّل أولاً:\n  npx cap add android && npx cap sync android'
    );
    process.exit(1);
  }

  await verifyCapacitorConfig();
  await patchManifest();
  await writeNotificationIcon();
  await ensureStrings();
  await writeLauncherIcons();

  console.log('✅ تجهيز مشروع أندرويد:');
  for (const change of changes) console.log(`   • ${change}`);
  for (const warning of warnings) console.log(`   ⚠️  ${warning}`);
}

main().catch((error) => {
  console.error('❌ فشل تجهيز مشروع أندرويد:', error.message);
  process.exit(1);
});
