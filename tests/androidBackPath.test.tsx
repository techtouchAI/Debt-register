import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { seedOfficeProfile } from './helpers';
import { endShutdown } from '@/lib/lifecycle';
import {
  installNativeBackGuard,
  resetNativeBackGuardForTests,
  setNativeBackSubscriber,
  type NativeBackEvent
} from '@/lib/nativeBridge';
import { openModalCount } from '@/lib/modalStack';

/**
 * مسار زر الرجوع على أندرويد — من الجسر الأصلي إلى الشاشة.
 *
 * ملاحظة مهمّة عن سبب وجود هذا الملف: الاختبارات السابقة كانت تحقن مستمعاً
 * وهمياً وتفحص القرار في الواجهة، فنجحت كلها بينما كان زر الرجوع على الجهاز
 * **يُنهي التطبيق فوراً**. السبب لم يكن في منطق الواجهة إطلاقاً، بل في أن
 * الحدث الأصلي لم يكن يصل إليها: حِزم `@capacitor/*` كانت في
 * `optionalDependencies`، وأداة Capacitor تقرأ الإضافات من
 * `dependencies`/`devDependencies` فقط (`getDependencies` في @capacitor/cli)،
 * فكان ناتج `cap sync` هو `assets/capacitor.plugins.json = []` أي **بلا
 * `AppPlugin` داخل الـ APK**. وبلا AppPlugin لا يُسجَّل أي
 * `OnBackPressedCallback` في النشاط، فينفّذ النظام السلوك الافتراضي:
 * `finish()` = خروج كامل من التطبيق. ورفض `App.addListener` كان يُبتلع
 * بصمت في `subscribeNativeBack` (تحذير في الطرفية فقط).
 *
 * لذلك يقيس هذا الملف ثلاثة أمور لا تقيسها اختبارات الواجهة وحدها:
 *   1) أن كل إضافة أصلية مستوردة مُعلنة حيث يقرأها `cap sync` فعلاً.
 *   2) أن مستمع الرجوع الأصلي مسجَّل منذ لحظة الإقلاع (لا خروج قبل جاهزية الواجهة).
 *   3) أن كل ضغطة رجوع = خطوة واحدة بالضبط، ولا خروج إلا بقرار صريح.
 */

let lastBackListener: ((event: NativeBackEvent) => void) | null = null;
let subscriberCalls = 0;

beforeEach(() => {
  cleanup();
  lastBackListener = null;
  subscriberCalls = 0;
  resetNativeBackGuardForTests();
  setNativeBackSubscriber((listener) => {
    subscriberCalls += 1;
    lastBackListener = listener;
    return { remove: () => undefined };
  });
});

afterEach(() => {
  cleanup();
  resetNativeBackGuardForTests();
  setNativeBackSubscriber(null);
  endShutdown();
});

/* ------------------------------------------------------------------ *
 * 1) السبب الجذري: تسجيل الإضافات الأصلية
 * ------------------------------------------------------------------ */

/**
 * نفس القاعدة التي تنفّذها `getDependencies()` في @capacitor/cli:
 * `dependencies` + `devDependencies` — ولا شيء غيرهما.
 * أي إضافة أصلية خارج هاتين القائمتين لا يراها `cap sync` ولا تُبنى في APK،
 * والنتيجة بالضبط: زر رجوع يُنهي التطبيق.
 */
function declaredForCapSync(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): Set<string> {
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
}

function capacitorPackagesImportedBySource(): string[] {
  const root = join(import.meta.dirname, '..', 'src');
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      for (const match of text.matchAll(/from '(@capacitor\/[a-z-]+)'/g)) found.add(match[1]);
    }
  };
  walk(root);
  return [...found].sort();
}

describe('تسجيل إضافات Capacitor الأصلية (السبب الجذري لخروج التطبيق بزر الرجوع)', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const declared = declaredForCapSync(pkg);
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));

  it('كل إضافة أصلية يستوردها الكود مُعلنة في dependencies أو devDependencies', () => {
    const imported = capacitorPackagesImportedBySource();
    // حماية من اختبار فارغ: يجب أن يشمل الفحص الإضافات المستخدمة فعلاً
    expect(imported).toContain('@capacitor/app');
    expect(imported).toContain('@capacitor/core');
    for (const name of imported) {
      expect(
        declared.has(name),
        `${name} مستوردة ولا يراها cap sync (لن تُبنى داخل APK) — انقلها من optionalDependencies إلى dependencies`
      ).toBe(true);
    }
  });

  it('إضافة الرجوع (@capacitor/app) غير موجودة في optionalDependencies', () => {
    // optionalDependencies لا تدخل في getDependencies() في @capacitor/cli،
    // فوجودها هناك = APK بلا AppPlugin = خروج فوري بزر الرجوع.
    for (const name of [
      '@capacitor/app',
      '@capacitor/core',
      '@capacitor/android',
      '@capacitor/filesystem',
      '@capacitor/local-notifications',
      '@capacitor/share'
    ]) {
      expect(optional.has(name), `${name} في optionalDependencies ⇒ لن يراها cap sync`).toBe(false);
      expect(declared.has(name), `${name} يجب أن تكون في dependencies/devDependencies`).toBe(true);
    }
    expect(declared.has('@capacitor/cli')).toBe(true);
  });

  it('الجسر يستخدم واجهة @capacitor/app الرسمية للرجوع (لا global قديم)', () => {
    const bridge = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'nativeBridge.ts'), 'utf8');
    expect(bridge).toMatch(/App\.addListener\('backButton'/);
    expect(bridge).toMatch(/Capacitor\.isNativePlatform\(\)/);
  });

  it('main.tsx يثبّت حارس الرجوع قبل رسم الواجهة', () => {
    const mainTsx = readFileSync(join(import.meta.dirname, '..', 'src', 'main.tsx'), 'utf8');
    expect(mainTsx).toMatch(/installNativeBackGuard\(\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 2) الحارس المبكر: لا خروج قبل جاهزية الواجهة
 * ------------------------------------------------------------------ */

describe('الحارس المبكر لزر الرجوع (قبل جاهزية الواجهة)', () => {
  it('تنصيبه يسجّل مستمع الرجوع الأصلي فعلاً (فيمتنع النظام عن إنهاء التطبيق)', () => {
    installNativeBackGuard();
    expect(subscriberCalls).toBe(1);
    expect(lastBackListener).not.toBeNull();
  });

  it('لا يُسجَّل المستمع أكثر من مرة عند استدعاء الحارس مراراً', () => {
    installNativeBackGuard();
    installNativeBackGuard();
    installNativeBackGuard();
    expect(subscriberCalls).toBe(1);
  });

  it('ضغطة الرجوع أثناء الإقلاع (لا معالج مدرك للمسار بعد) لا تُنهي التطبيق', async () => {
    installNativeBackGuard();
    const exitApp = vi.fn();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    act(() => {
      lastBackListener?.({ canGoBack: false, exitApp });
    });
    await Promise.resolve();

    expect(exitApp).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(openModalCount()).toBe(0);
    closeSpy.mockRestore();
  });
});


/**
 * انتظار وصول المسار إلى قيمة محددة بعد ضغطة رجوع.
 * الرجوع يمرّ بدورة سجل (history + React Router) غير متزامنة، فننتظرها بدل
 * الاعتماد على قراءة فورية. نُغلّف الانتظار بـ `act` حتى تُفرَّغ تحديثات React
 * بشكل حتمي بعد كل دورة.
 */
async function expectHash(expected: string, timeout = 5000): Promise<void> {
  const started = Date.now();
  while (window.location.hash !== expected) {
    if (Date.now() - started > timeout) {
      throw new Error(`لم يصل المسار إلى ${expected} — المسار الحالي: ${window.location.hash}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  expect(window.location.hash).toBe(expected);
}

/* ------------------------------------------------------------------ *
 * 3) التكامل: ضغطة واحدة = خطوة واحدة، ولا خروج إلا بقرار صريح
 * ------------------------------------------------------------------ */

describe('القرار الموحّد بعد جاهزية الواجهة', () => {
  const pressBack = (exitApp = vi.fn()) => {
    act(() => {
      lastBackListener?.({ canGoBack: false, exitApp });
    });
    return exitApp;
  };

  async function bootApp(hash: string) {
    await seedOfficeProfile('مكتب الاختبار');
    window.location.hash = hash;
    render(<App />);
    await waitFor(() => expect(screen.queryByText('جاري تحميل بيانات المكتب…')).toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(lastBackListener).not.toBeNull(), { timeout: 5000 });
  }

  it('صفحة داخلية: ضغطة واحدة = شاشة واحدة للخلف (لا خطوتين ولا خروج)', async () => {
    await bootApp('#/customers');
    expect(screen.getByText('إدارة العملاء ومتابعة الديون')).toBeTruthy();

    const exitApp = pressBack();

    await expectHash('#/');
    await waitFor(() => expect(screen.getByText(/مرحباً بك في/)).toBeTruthy(), { timeout: 5000 });
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('تنقّل عدة مستويات: الرجوع خطوة بخطوة حتى الجذر ثم تأكيد الخروج', async () => {
    (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };
    await bootApp('#/');

    // الرئيسية ⇒ قائمة الفواتير (تنقّل حقيقي من القائمة الجانبية)
    fireEvent.click(screen.getByText('الفواتير والمبيعات', { selector: 'nav *' }));
    await expectHash('#/invoices');

    // قائمة الفواتير ⇒ نموذج فاتورة جديدة (مستوى أعمق)
    fireEvent.click(screen.getByText('فاتورة بيع جديدة'));
    await expectHash('#/invoices/new');

    // رجوع ⇒ القائمة (خطوة واحدة بالضبط، لا قفزة إلى الرئيسية)
    pressBack();
    await expectHash('#/invoices');

    // رجوع ⇒ الرئيسية
    pressBack();
    await expectHash('#/');

    // ورجوع ثالث عند الجذر ⇒ حوار تأكيد الخروج (لا خروج صامت)
    const exitApp = pressBack();
    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy(), { timeout: 5000 });
    expect(exitApp).not.toHaveBeenCalled();

    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('الرئيسية: تأكيد خروج صريح بدل إنهاء التطبيق بضغطة واحدة', async () => {
    (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };
    await bootApp('#/');

    const exitApp = pressBack();
    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy(), { timeout: 5000 });
    expect(exitApp).not.toHaveBeenCalled();

    // ضغطة ثانية تُغلق الحوار وحده
    pressBack();
    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).toBeNull(), { timeout: 5000 });
    expect(screen.getByText(/مرحباً بك في/)).toBeTruthy();

    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('شاشة معالج التشغيل الأول: الرجوع يعرض تأكيد الخروج ولا يُنهي التطبيق', async () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };

    // نفس ما يحدث في main.tsx: الحارس المبكر مسجَّل قبل رسم الواجهة
    installNativeBackGuard();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب/)).toBeTruthy(), { timeout: 5000 });

    const exitApp = pressBack();
    await waitFor(() => expect(screen.getByText('الخروج من التطبيق؟')).toBeTruthy(), { timeout: 5000 });
    expect(exitApp).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // الرجوع مرة أخرى يُغلق الحوار ويُبقي المستخدم في المعالج
    pressBack();
    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).toBeNull(), { timeout: 5000 });
    expect(screen.getByText(/مرحباً بك في نظام إدارة المكتب/)).toBeTruthy();
    expect(closeSpy).not.toHaveBeenCalled();

    closeSpy.mockRestore();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });
});
