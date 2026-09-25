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
 *   - مزوّد الملفات (FileProvider) الذي يتطلبه @capacitor/share: بلا إعلانه في
 *     المانيفست بسلطة `${applicationId}.fileprovider` تفشل مشاركة ملف محلي
 *     (`file://`) كلياً — أي أن حفظ/مشاركة PDF والنسخ الاحتياطية يفشل على الجهاز.
 *   - أيقونة التطبيق وشاشة البدء: القالب يأتي بأيقونة Capacitor الافتراضية
 *     وصورة بدء ممطوطة؛ تُنسخ موارد `resources/android/res` (المولَّدة بـ
 *     `npm run icons`) وتُحذف صور splash.png من القالب.
 *
 * التشغيل المتكرر آمن: لا يُكرر أي وسم ولا يستبدل شيئاً موجوداً إلا القيم
 * المقصودة. الدوال مُصدَّرة لتُختبر مباشرة على مشروع مؤقت في `tests/`.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/** صنف مزوّد الملفات الذي يستخدمه @capacitor/share. */
export const FILE_PROVIDER_CLASS = 'androidx.core.content.FileProvider';

/** سلطة المزوّد التي يبحث عنها Share: packageName + ".fileprovider". */
export const FILE_PROVIDER_AUTHORITY = '${applicationId}.fileprovider';

/** مصدر الحقيقة الوحيد لمسارات المزوّد (يُستنسخ إلى مشروع أندرويد). */
export const FILE_PROVIDER_PATHS_SOURCE = 'resources/android/file_paths.xml';

/** مورد المسارات الذي يشير إليه المزوّد. */
export const FILE_PROVIDER_PATHS_RESOURCE = '@xml/file_paths';

/**
 * موارد أيقونة التطبيق وشاشة البدء الجاهزة (مولَّدة بـ `npm run icons`):
 * تُنسخ بالمسارات نفسها إلى `android/app/src/main/res` (مصدر واحد للحقيقة).
 */
export const LAUNCHER_RES_SOURCE = 'resources/android/res';

/**
 * صور شاشة البدء في قالب Capacitor. شاشة البدء صارت `drawable/splash.xml`:
 * بقاء `drawable/splash.png` بجانبها مورد مكرر يُفشل البناء، وصور
 * `drawable-port-*`/`drawable-land-*` تتقدّم عليها فتعود الصورة الممطوطة القديمة.
 */
const TEMPLATE_SPLASH_IMAGE = /^splash\.(png|9\.png|jpe?g|webp)$/i;

/** كل الملفات تحت مجلد (مسارات نسبية بفواصل /)، مرتبة لنتيجة حتمية. */
async function listFilesRecursive(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFilesRecursive(join(dir, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

/**
 * ينسخ موارد الأيقونة وشاشة البدء ويحذف صور البدء القديمة من القالب.
 * متكرر: لا يكتب ملفاً مطابقاً ولا يحذف إلا صور splash.* في مجلدات drawable.
 */
export async function installLauncherResources(root, resDir) {
  const sourceDir = join(root, LAUNCHER_RES_SOURCE);
  if (!existsSync(sourceDir)) {
    throw new Error(`لم يُعثر على موارد أيقونة التطبيق: ${LAUNCHER_RES_SOURCE} (نفّذ npm run icons)`);
  }
  const files = await listFilesRecursive(sourceDir);
  if (!files.some((file) => file === 'mipmap-anydpi-v26/ic_launcher.xml')) {
    throw new Error(`موارد أيقونة التطبيق ناقصة في ${LAUNCHER_RES_SOURCE} (نفّذ npm run icons)`);
  }

  const written = [];
  for (const file of files) {
    const source = await readFile(join(sourceDir, file));
    const target = join(resDir, file);
    const previous = existsSync(target) ? await readFile(target) : null;
    if (previous && previous.equals(source)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    written.push(file);
  }

  const removed = [];
  const shipped = new Set(files);
  for (const entry of await readdir(resDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^drawable(-|$)/.test(entry.name)) continue;
    const dir = join(resDir, entry.name);
    let removedHere = 0;
    for (const file of await readdir(dir)) {
      if (!TEMPLATE_SPLASH_IMAGE.test(file) || shipped.has(`${entry.name}/${file}`)) continue;
      await rm(join(dir, file));
      removed.push(`${entry.name}/${file}`);
      removedHere += 1;
    }
    // مجلدات drawable-port-*/land-* لم يعد فيها شيء بعد حذف صورة القالب
    if (removedHere > 0 && (await readdir(dir)).length === 0) await rm(dir, { recursive: true });
  }
  return { files: files.length, written, removed };
}

/**
 * أي وسم <provider>: ذاتي الإغلاق أو مقترن حتى نهايته.
 * (المطابقة الكسولة `[\s\S]*?` تقف عند أول `/>` داخل الوسم — أي عند `meta-data`
 * فتقطعه من منتصفه؛ لذلك الفرعان صريحان.)
 */
const PROVIDER_BLOCK = /<provider\b[^>]*\/>|<provider\b[^>]*>[\s\S]*?<\/provider>/g;

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
  // captureInput يستبدل محرر WebView الحقيقي باتصال إدخال بدائي غير قابل
  // للتحرير (BaseInputConnection بلا محرر كامل): لوحة المفاتيح العربية
  // والاقتراحات التلقائية تستبدل الكلمات عبره فتُحذف كلمات ويختفي النص.
  if (config.android?.captureInput) {
    throw new Error('captureInput يجب ألا يُفعَّل: يُفسد الكتابة بلوحة المفاتيح (حذف كلمات واختفاء النص)');
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

/** يفرض قيمة سمة داخل وسم واحد (يحدّث القيمة أو يضيف السمة). */
function setTagAttribute(tag, name, attribute, value) {
  const pattern = new RegExp(`${attribute}="[^"]*"`);
  if (pattern.test(tag)) return tag.replace(pattern, `${attribute}="${value}"`);
  return tag.replace(new RegExp(`<${name}`), `<${name}\n        ${attribute}="${value}"`);
}

/** يفرض قيمة سمة على وسم <application> (يضيفها إن لم تكن موجودة). */
export function ensureApplicationAttribute(manifestXml, attribute, value) {
  const applicationMatch = manifestXml.match(/<application[\s\S]*?>/);
  if (!applicationMatch) throw new Error('لم يُعثر على وسم <application> في المانيفست');
  return manifestXml.replace(applicationMatch[0], setTagAttribute(applicationMatch[0], 'application', attribute, value));
}

/** السمات التي يتولاها هذا السكربت في مزوّد الملفات (تُكتب دائماً بالقيم القياسية). */
const MANAGED_PROVIDER_ATTRIBUTES = ['android:authorities', 'android:exported', 'android:grantUriPermissions'];

/** تعبير مسار المزوّد داخل المزوّد (يُصحَّح إن أشار إلى ملف آخر). */
const PROVIDER_METADATA = /<meta-data[^>]*android:name="android\.support\.FILE_PROVIDER_PATHS"[\s\S]*?\/>/;

/** سمات وسم واحد في خريطة (الترتيب غير مهم لأن البناء قياسي). */
function attributeMap(tag) {
  return new Map([...tag.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

/** سطر meta-data الذي يربط المزوّد بملف المسارات (بإزاحة الأب + 4). */
function providerMetaDataLine(indent) {
  const inner = `${indent}    `;
  return [
    `${inner}<meta-data`,
    `${inner}    android:name="android.support.FILE_PROVIDER_PATHS"`,
    `${inner}    android:resource="${FILE_PROVIDER_PATHS_RESOURCE}" />`
  ].join('\n');
}

/**
 * وسم فتح المزوّد بصيغة قياسية واحدة: الاسم ثم أي سمات أخرى موجودة (مرتبة)
 * ثم السمات المُدارة — فالنتيجة حتمية ويتوقف التغيير بعد أول تشغيل.
 * إزاحة السطر الأول لا تُضاف هنا (يأتي موضع الإدراج بها)، والباقي بإزاحة + 4.
 */
function providerOpenTag(indent, authority, existingTag = '') {
  const attributes = attributeMap(existingTag);
  const extras = [...attributes.keys()]
    .filter((key) => key !== 'android:name' && !MANAGED_PROVIDER_ATTRIBUTES.includes(key))
    .sort();
  const inner = `${indent}    `;
  return [
    '<provider',
    `${inner}android:name="${FILE_PROVIDER_CLASS}"`,
    ...extras.map((key) => `${inner}${key}="${attributes.get(key)}"`),
    `${inner}android:authorities="${authority}"`,
    `${inner}android:exported="false"`,
    `${inner}android:grantUriPermissions="true">`
  ].join('\n');
}

/** جسم مزوّد الملفات كاملاً (يُكتب داخل <application> على مستوى الوسوم الشقيقة). */
function fileProviderBlock(indent, authority = FILE_PROVIDER_AUTHORITY) {
  return `${indent}${providerOpenTag(indent, authority)}\n${providerMetaDataLine(indent)}\n${indent}</provider>`;
}

/**
 * يضمن مزوّد ملفات صالحاً لمشاركة الملفات المحلية (@capacitor/share).
 *  - غائب ⇒ يُضاف مرة واحدة داخل <application>.
 *  - موجود لكن ناقصاً أو مخالفاً (سمة مخالفة، مورد مسارات آخر، وسم ذاتي الإغلاق
 *    بلا meta-data) ⇒ يُعاد بناؤه بالصيغة القياسية نفسها، فالمزوّد الناقص يفشل
 *    وقت التشغيل عند مشاركة أي ملف.
 */
export function ensureFileProvider(manifestXml, authority = FILE_PROVIDER_AUTHORITY) {
  const matches = [...manifestXml.matchAll(PROVIDER_BLOCK)];
  const existing = matches.find((match) => match[0].includes(`android:name="${FILE_PROVIDER_CLASS}"`));

  if (!existing) {
    if (!manifestXml.includes('</application>')) {
      throw new Error('ملف المانيفست غير مكتمل (لا يوجد وسم </application>)');
    }
    const lastClose = manifestXml.lastIndexOf('</application>');
    const closeIndent = manifestXml.slice(0, lastClose).match(/([ \t]*)$/)?.[1] ?? '';
    const before = manifestXml.slice(0, lastClose).replace(/[ \t]*$/, '');
    const providerIndent = `${closeIndent}    `;
    const xml = `${before}${fileProviderBlock(providerIndent, authority)}\n${closeIndent}${manifestXml.slice(lastClose)}`;
    return { xml, added: true, repaired: false };
  }

  const element = existing[0];
  const openTag = element.match(/^<provider\b[^>]*\/?>/)?.[0];
  if (!openTag) throw new Error('تعذّر قراءة وسم مزوّد الملفات في المانيفست');

  const indent = manifestXml.slice(0, existing.index).match(/([ \t]*)$/)?.[1] ?? '';
  const header = providerOpenTag(indent, authority, openTag);
  const body = openTag.endsWith('/>') ? '' : element.slice(openTag.length, element.length - '</provider>'.length);

  let normalized;
  if (PROVIDER_METADATA.test(body)) {
    // مسار المزوّد موجود: يُصحَّح إن أشار إلى ملف آخر، ويُحفظ ما عداه كما هو
    const fixedBody = body.replace(PROVIDER_METADATA, (block) =>
      block.includes('android:resource=')
        ? block.replace(/android:resource="[^"]*"/, `android:resource="${FILE_PROVIDER_PATHS_RESOURCE}"`)
        : block.replace(/\/>$/, `android:resource="${FILE_PROVIDER_PATHS_RESOURCE}" />`)
    );
    normalized = `${header}${fixedBody}</provider>`;
  } else {
    const keptBody = body.replace(/\s+$/, '');
    normalized = `${header}\n${keptBody ? `${keptBody}\n` : ''}${providerMetaDataLine(indent)}\n${indent}</provider>`;
  }

  const xml = manifestXml.replace(element, normalized);
  return { xml, added: false, repaired: xml !== manifestXml };
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
  const provider = ensureFileProvider(manifest);
  manifest = provider.xml;
  await writeFile(manifestPath, manifest, 'utf8');
  for (const name of addedPermissions) log(`أُضيفت صلاحية: ${name}`);
  log(
    `المانيفست جاهز: أُضيفت ${addedPermissions.length} صلاحية، موجودة مسبقاً ${existingPermissions.length}، ومنع النص الصريح مفروض`
  );
  if (provider.added) log(`أُضيف مزوّد الملفات (${FILE_PROVIDER_AUTHORITY}) لمشاركة PDF والنسخ`);
  else if (provider.repaired) log('صُحّح إعلان مزوّد الملفات ليطابق ما يتوقعه @capacitor/share');

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

  /* 2ب) مسارات مزوّد الملفات: تُنسخ من أصل المستودع (مصدر واحد للحقيقة) */
  const pathsSourcePath = join(root, FILE_PROVIDER_PATHS_SOURCE);
  if (!existsSync(pathsSourcePath)) {
    throw new Error(`لم يُعثر على أصل مسارات مزوّد الملفات: ${FILE_PROVIDER_PATHS_SOURCE}`);
  }
  const pathsSource = await readFile(pathsSourcePath, 'utf8');
  const xmlDir = join(androidDir, 'app/src/main/res/xml');
  await mkdir(xmlDir, { recursive: true });
  const pathsPath = join(xmlDir, 'file_paths.xml');
  const previousPaths = existsSync(pathsPath) ? await readFile(pathsPath, 'utf8') : null;
  const pathsWritten = previousPaths !== pathsSource;
  if (pathsWritten) await writeFile(pathsPath, pathsSource, 'utf8');
  log(pathsWritten ? 'كُتب res/xml/file_paths.xml' : 'res/xml/file_paths.xml موجود ومطابق');

  /* 2ج) أيقونة التطبيق (تكيفية + أحادية اللون + قديمة) وشاشة البدء */
  const launcher = await installLauncherResources(root, join(androidDir, 'app/src/main/res'));
  log(
    launcher.written.length > 0
      ? `كُتبت موارد أيقونة التطبيق وشاشة البدء: ${launcher.written.length} من ${launcher.files} ملفاً`
      : `موارد أيقونة التطبيق وشاشة البدء موجودة ومطابقة (${launcher.files} ملفاً)`
  );
  if (launcher.removed.length > 0) {
    log(`حُذفت صور شاشة البدء القديمة من القالب (${launcher.removed.length}): استُبدلت بـ drawable/splash.xml`);
  }

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
    iconWritten,
    pathsWritten,
    launcherFilesWritten: launcher.written,
    splashImagesRemoved: launcher.removed,
    fileProviderAdded: provider.added,
    fileProviderRepaired: provider.repaired
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
      if (error instanceof Error && !error.message.match(/مجلد android|لم يُعثر|يجب أن|appName|iconColor|sound|allowMixedContent|أصل أيقونة|موارد أيقونة/)) {
        console.error(error);
      }
      process.exit(1);
    });
}
