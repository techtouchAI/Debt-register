import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { HashRouter } from 'react-router-dom';
import { RouteGuard } from '@/components/auth/AuthGate';
import { setSessionUser } from '@/lib/session';

/**
 * حراسة المسارات حسب صلاحية المستخدم.
 *
 * تحديثات الموجّه تمر عبر انتقالات React؛ فتنقّلٌ في السجل (زر الرجوع/التقدّم،
 * أو كتابة رابط في المتصفح) قد يتجاوز تحويلاً معلّقاً إلى الرئيسية. إن كان
 * الموقع الجديد مطابقاً لما هو مرسوم أصلاً فلا تُعاد الرسمة — والحارس الذي
 * يعتمد على الرسم وحده كان يترك صفحة فارغة على مسار غير مسموح.
 */

/** تنقّل في السجل كما يفعله المتصفح: مدخل جديد بلا حالة ثم حدث popstate. */
function browserNavigate(hash: string) {
  window.history.pushState(null, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

/** يُطلق تنقّلاً في السجل مباشرة بعد تأثيرات الحارس — قبل تثبيت تحويله المعلّق. */
function NavigateRightAfterGuard({ hash }: { hash: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    browserNavigate(hash);
  }, [hash]);
  return null;
}

function renderGuarded(extra?: React.ReactNode) {
  return render(
    <HashRouter>
      <RouteGuard>
        <p>محتوى الصفحة</p>
      </RouteGuard>
      {extra}
    </HashRouter>
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/');
  setSessionUser({ id: 2, name: 'أحمد', role: 'sales' });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '#/');
});

describe('حراسة المسارات حسب الصلاحية', () => {
  it('تنقّل في السجل إلى صفحة مدير يعيد موظف المبيعات للرئيسية', async () => {
    renderGuarded();
    expect(screen.getByText('محتوى الصفحة')).toBeTruthy();

    await act(async () => browserNavigate('#/settings'));

    expect(window.location.hash).toBe('#/');
    expect(screen.getByText('محتوى الصفحة')).toBeTruthy();
  });

  it('لا يترك صفحة فارغة إن تجاوز تنقّلٌ في السجل تحويلاً معلّقاً إلى الرئيسية', async () => {
    // الموظف يدخل والتطبيق على صفحة تركها المدير، وقبل تثبيت التحويل يصل تنقّل
    // في السجل إلى الصفحة نفسها (موقع مطابق لما رُسم ⇒ لا إعادة رسم)
    window.history.replaceState(null, '', '#/settings');
    renderGuarded(<NavigateRightAfterGuard hash="#/settings" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.location.hash).toBe('#/');
    expect(screen.getByText('محتوى الصفحة')).toBeTruthy();
  });

  it('المدير يفتح كل الصفحات دون تحويل', async () => {
    setSessionUser({ id: 1, name: 'المدير', role: 'admin' });
    renderGuarded();

    await act(async () => browserNavigate('#/settings'));

    expect(window.location.hash).toBe('#/settings');
    expect(screen.getByText('محتوى الصفحة')).toBeTruthy();
  });
});
