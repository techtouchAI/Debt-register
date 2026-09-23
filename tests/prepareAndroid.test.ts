import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILE_PROVIDER_AUTHORITY,
  FILE_PROVIDER_CLASS,
  FILE_PROVIDER_PATHS_SOURCE,
  NOTIFICATION_ICON_SOURCE,
  PERMISSIONS,
  ensureApplicationAttribute,
  ensureFileProvider,
  ensurePermission,
  prepareAndroid,
  syncAppName,
  validateCapacitorConfig
} from '../scripts/prepare-android.mjs';

/**
 * سكربت تجهيز مشروع أندرويد (`scripts/prepare-android.mjs`).
 *
 * سبب هذه الاختبارات: خطأ حقيقي في CI أوقف بناء الـ APK —
 * `Found item String/app_name more than one time` لأن السكربت كان يُضيف وسم
 * `app_name` بدل مزامنة الموجود. الاختبارات هنا تشغّل السكربت فعلياً على مشروع
 * مؤقت وتتحقق من عدم تكرار أي وسم ومن أن التشغيل مرتين لا يغيّر بايتاً واحداً.
 *
 * كذلك تغطي مزوّد الملفات (FileProvider): بدونه يفشل `Share.share({ url: 'file://…' })`
 * وقت التشغيل لأن @capacitor/share يبحث عن سلطة `${applicationId}.fileprovider`.
 */

const CAPACITOR_CONFIG = {
  appId: 'com.agrioffice.debtregister',
  appName: 'إدارة المكتب الزراعي',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_agri', iconColor: '#16a34a' },
    Filesystem: { androidRequestPermissions: true }
  },
  android: { allowMixedContent: false }
};

const CAPACITOR_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>
`;

const CAPACITOR_STRINGS = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">إدارة المكتب الزراعي</string>
    <string name="title_activity_main">MainActivity</string>
    <string name="package_name">com.agrioffice.debtregister</string>
</resources>
`;

async function createFakeAndroidProject(strings = CAPACITOR_STRINGS, manifest = CAPACITOR_MANIFEST) {
  const root = await mkdtemp(join(tmpdir(), 'agri-android-'));
  await mkdir(join(root, 'android/app/src/main/res/values'), { recursive: true });
  await mkdir(join(root, 'resources/android'), { recursive: true });
  await writeFile(join(root, 'android/app/src/main/AndroidManifest.xml'), manifest, 'utf8');
  await writeFile(join(root, 'android/app/src/main/res/values/strings.xml'), strings, 'utf8');
  await writeFile(join(root, 'capacitor.config.json'), JSON.stringify(CAPACITOR_CONFIG, null, 2), 'utf8');
  // مثل المستودع: أصول أندرويد (الأيقونة ومسارات المزوّد) مصدرها resources/android
  await cp(join(process.cwd(), NOTIFICATION_ICON_SOURCE), join(root, NOTIFICATION_ICON_SOURCE));
  await cp(join(process.cwd(), FILE_PROVIDER_PATHS_SOURCE), join(root, FILE_PROVIDER_PATHS_SOURCE));
  return root;
}

describe('مزامنة app_name (السبب الجذري لفشل بناء APK)', () => {
  it('لا يُكرر الوسم عندما يكون موجوداً ويحدّث قيمته', () => {
    const result = syncAppName(CAPACITOR_STRINGS, 'مكتب الرافدين الزراعي');
    expect(result.duplicates).toBe(0);
    expect(result.added).toBe(false);
    expect(result.xml.match(/name="app_name"/g)).toHaveLength(1);
    expect(result.xml).toContain('<string name="app_name">مكتب الرافدين الزراعي</string>');
    // بقية الوسوم لم تُمسّ
    expect(result.xml).toContain('<string name="package_name">com.agrioffice.debtregister</string>');
  });

  it('يدمج النسخ المكررة (مشروع مُجهَّز بنسخة أقدم) في نسخة واحدة', () => {
    const duplicated = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">قديم</string>
    <string name="title_activity_main">MainActivity</string>
    <string name="app_name">إدارة المكتب الزراعي</string>
</resources>
`;
    const result = syncAppName(duplicated, 'إدارة المكتب الزراعي');
    expect(result.duplicates).toBe(1);
    expect(result.xml.match(/name="app_name"/g)).toHaveLength(1);
  });

  it('يضيف الوسم مرة واحدة إذا كان غائباً', () => {
    const withoutAppName = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="title_activity_main">MainActivity</string>
</resources>
`;
    const result = syncAppName(withoutAppName, 'مكتب الأنبار');
    expect(result.added).toBe(true);
    expect(result.xml.match(/name="app_name"/g)).toHaveLength(1);
    expect(result.xml.indexOf('app_name')).toBeLessThan(result.xml.indexOf('</resources>'));
  });

  it('يهرّب المحارف الخاصة في اسم التطبيق', () => {
    const result = syncAppName(CAPACITOR_STRINGS, 'مكتب & شركاء <الزراعة>');
    expect(result.xml).toContain('مكتب &amp; شركاء &lt;الزراعة&gt;');
    expect(result.xml).not.toContain('<الزراعة>');
  });
});

describe('الصلاحيات وسمات التطبيق', () => {
  it('يضيف كل صلاحية مرة واحدة فقط', () => {
    let manifest = CAPACITOR_MANIFEST;
    for (const permission of PERMISSIONS) {
      manifest = ensurePermission(manifest, permission).xml;
      manifest = ensurePermission(manifest, permission).xml; // تشغيل ثانٍ بلا تكرار
    }
    for (const permission of PERMISSIONS) {
      const occurrences = manifest.split(`android:name="${permission.name}"`).length - 1;
      expect(occurrences, permission.name).toBe(1);
    }
    expect(manifest).toContain('android:maxSdkVersion="29"');
    expect(manifest).toContain('android:maxSdkVersion="32"');
    expect(manifest.indexOf('<uses-permission')).toBeLessThan(manifest.indexOf('</manifest>'));
  });

  it('يفرض قيم السمات حتى لو كانت مخالفة أو غائبة', () => {
    const disabled = CAPACITOR_MANIFEST.replace(
      'android:allowBackup="true"',
      'android:allowBackup="true"\n        android:usesCleartextTraffic="true"'
    );
    const fixed = ensureApplicationAttribute(disabled, 'android:usesCleartextTraffic', 'false');
    expect(fixed).toContain('android:usesCleartextTraffic="false"');
    expect(fixed).not.toContain('usesCleartextTraffic="true"');

    const added = ensureApplicationAttribute(disabled, 'android:hardwareAccelerated', 'true');
    expect(added).toContain('android:hardwareAccelerated="true"');
    expect(added.match(/<application/g)).toHaveLength(1);
  });

  it('يرفض إعداد Capacitor ناقصاً أو غير متوافق', () => {
    expect(() => validateCapacitorConfig({ ...CAPACITOR_CONFIG, appName: '' })).toThrow(/appName/);

    const noIcon = structuredClone(CAPACITOR_CONFIG);
    delete (noIcon.plugins.LocalNotifications as { smallIcon?: string }).smallIcon;
    expect(() => validateCapacitorConfig(noIcon)).toThrow(/smallIcon/);

    const mixed = structuredClone(CAPACITOR_CONFIG);
    mixed.android.allowMixedContent = true;
    expect(() => validateCapacitorConfig(mixed)).toThrow(/allowMixedContent/);

    const withSound = structuredClone(CAPACITOR_CONFIG);
    (withSound.plugins.LocalNotifications as { sound?: string }).sound = 'beep.mp3';
    expect(() => validateCapacitorConfig(withSound)).toThrow(/sound/);
  });
});

describe('مزوّد الملفات لمشاركة الملفات (يحتاجه @capacitor/share)', () => {
  it('يضيف المزوّد مرة واحدة بالسلطة والصيغة التي يبحث عنها Share', () => {
    const first = ensureFileProvider(CAPACITOR_MANIFEST);
    expect(first.added).toBe(true);
    expect(first.repaired).toBe(false);
    expect(first.xml).toContain(`android:name="${FILE_PROVIDER_CLASS}"`);
    expect(first.xml).toContain(`android:authorities="${FILE_PROVIDER_AUTHORITY}"`);
    expect(first.xml).toContain('android:exported="false"');
    expect(first.xml).toContain('android:grantUriPermissions="true"');
    expect(first.xml).toContain('android:resource="@xml/file_paths"');
    expect(first.xml.indexOf('<provider')).toBeLessThan(first.xml.indexOf('</application>'));

    // تشغيل ثانٍ: لا نسخة ثانية ولا تغيير في البايتات
    const second = ensureFileProvider(first.xml);
    expect(second.added).toBe(false);
    expect(second.repaired).toBe(false);
    expect(second.xml).toBe(first.xml);
    expect(second.xml.match(/<provider/g)).toHaveLength(1);
  });

  it('يصحّح إعلاناً ذاتي الإغلاق أو بسلطة مخالفة بدل تركه ناقصاً', () => {
    const broken = CAPACITOR_MANIFEST.replace(
      '</application>',
      '    <provider android:name="androidx.core.content.FileProvider" android:authorities="com.old.fileprovider" />\n    </application>'
    );
    const fixed = ensureFileProvider(broken);
    expect(fixed.added).toBe(false);
    expect(fixed.repaired).toBe(true);
    expect(fixed.xml).not.toContain('com.old.fileprovider');
    expect(fixed.xml).toContain('android:resource="@xml/file_paths"');
    expect(fixed.xml.match(/<provider/g)).toHaveLength(1);
    expect(ensureFileProvider(fixed.xml).repaired).toBe(false);
  });

  it('يوجّه مسار المزوّد إلى @xml/file_paths حتى لو أشار إلى ملف آخر', () => {
    const otherResource = CAPACITOR_MANIFEST.replace(
      '</application>',
      [
        '    <provider android:name="androidx.core.content.FileProvider"',
        '        android:authorities="x.fileprovider" android:exported="true">',
        '        <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/other_paths" />',
        '    </provider>',
        '    </application>'
      ].join('\n')
    );
    const fixed = ensureFileProvider(otherResource);
    expect(fixed.repaired).toBe(true);
    expect(fixed.xml).toContain('android:resource="@xml/file_paths"');
    expect(fixed.xml).not.toContain('@xml/other_paths');
    expect(fixed.xml.match(/android\.support\.FILE_PROVIDER_PATHS/g)).toHaveLength(1);
    expect(fixed.xml).toContain('android:exported="false"');
  });

  it('يحفظ السمات الإضافية الموضوعة يدوياً ولا يحذفها', () => {
    const withExtra = CAPACITOR_MANIFEST.replace(
      '</application>',
      '    <provider android:name="androidx.core.content.FileProvider" android:label="مزوّد الملفات" />\n    </application>'
    );
    const fixed = ensureFileProvider(withExtra);
    expect(fixed.xml).toContain('android:label="مزوّد الملفات"');
    expect(fixed.xml).toContain(`android:authorities="${FILE_PROVIDER_AUTHORITY}"`);
  });

  it('يفشل برسالة واضحة إذا كان المانيفست مبتوراً', () => {
    expect(() => ensureFileProvider('<manifest><application>')).toThrow(/\/application/);
  });
});

describe('التشغيل الفعلي على مشروع مؤقت', () => {
  it('يجهّز المشروع، ويكون التشغيل الثاني بلا أي تغيير في الملفات', async () => {
    const root = await createFakeAndroidProject();
    try {
      const first = await prepareAndroid({ root });
      expect(first.addedPermissions).toHaveLength(PERMISSIONS.length);
      expect(first.duplicatesRemoved).toBe(0);
      expect(first.iconWritten).toBe(true);
      expect(first.pathsWritten).toBe(true);
      expect(first.fileProviderAdded).toBe(true);
      expect(first.fileProviderRepaired).toBe(false);
      expect(first.appName).toBe('إدارة المكتب الزراعي');

      const manifestText = await readFile(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
      expect(manifestText).toContain(`android:authorities="${FILE_PROVIDER_AUTHORITY}"`);
      const pathsText = await readFile(join(root, 'android/app/src/main/res/xml/file_paths.xml'), 'utf8');
      expect(pathsText).toBe(await readFile(join(process.cwd(), FILE_PROVIDER_PATHS_SOURCE), 'utf8'));

      const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml');
      const stringsPath = join(root, 'android/app/src/main/res/values/strings.xml');
      const manifestAfterFirst = await readFile(manifestPath, 'utf8');
      const stringsAfterFirst = await readFile(stringsPath, 'utf8');

      const second = await prepareAndroid({ root });
      expect(second.addedPermissions).toHaveLength(0);
      expect(second.existingPermissions).toHaveLength(PERMISSIONS.length);
      expect(second.iconWritten).toBe(false);
      expect(second.pathsWritten).toBe(false);
      expect(second.fileProviderAdded).toBe(false);
      expect(second.fileProviderRepaired).toBe(false);
      expect(second.duplicatesRemoved).toBe(0);

      expect(await readFile(manifestPath, 'utf8')).toBe(manifestAfterFirst);
      expect(await readFile(stringsPath, 'utf8')).toBe(stringsAfterFirst);
      expect(stringsAfterFirst.match(/name="app_name"/g)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('يصلح مشروعاً يحتوي app_name مكرراً ويُنتج ملفاً صالحاً واحداً', async () => {
    const duplicated = CAPACITOR_STRINGS.replace(
      '</resources>',
      '    <string name="app_name">إدارة المكتب الزراعي</string>\n</resources>'
    );
    const root = await createFakeAndroidProject(duplicated);
    try {
      const result = await prepareAndroid({ root });
      expect(result.duplicatesRemoved).toBe(1);
      const strings = await readFile(join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
      expect(strings.match(/name="app_name"/g)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('يفشل برسالة واضحة إذا لم يُولَّد مجلد android', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agri-android-empty-'));
    try {
      await expect(prepareAndroid({ root })).rejects.toThrow(/مجلد android غير موجود/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('يفشل برسالة واضحة إذا غاب أصل مسارات المزوّد', async () => {
    const root = await createFakeAndroidProject();
    try {
      await rm(join(root, FILE_PROVIDER_PATHS_SOURCE));
      await expect(prepareAndroid({ root })).rejects.toThrow(/مسارات مزوّد الملفات/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('يكتب أيقونة الإشعارات المطابقة لملف المستودع', async () => {
    const root = await createFakeAndroidProject();
    try {
      await prepareAndroid({ root });
      const icon = await readFile(join(root, 'android/app/src/main/res/drawable/ic_stat_agri.xml'), 'utf8');
      // الأيقونة المُنتجة مطابقة للأصل المحفوظ في المستودع (يستخدمه تدقيق الأغلفة)
      const repoIcon = await readFile(join(process.cwd(), NOTIFICATION_ICON_SOURCE), 'utf8');
      // نسخة حرفية من أصل المستودع: مصدر واحد للحقيقة بلا نص مكرر في السكربت
      expect(icon).toBe(repoIcon);
      expect(icon).toContain('android:tint="#FFFFFFFF"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
