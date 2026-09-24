import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OverflowMarquee } from '@/components/ui/OverflowMarquee';
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost';
import { confirmDialog } from '@/lib/confirm';
import { hasOpenModal } from '@/lib/modalStack';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * jsdom لا يحسب التخطيط: نحاكي عرض الحاوية وعرض النص عبر خصائص العنصرين،
 * ونحاكي ResizeObserver لنتحقق أن الحركة تبدأ/تتوقف حسب القياس الفعلي.
 */
function mockMeasurements(containerWidth: number, textWidth: number) {
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('office-marquee') ? containerWidth : 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('office-marquee-text') ? textWidth : 0;
    }
  });
  return () => {
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
  };
}

describe('اسم المكتب المتحرك عند تجاوز المساحة', () => {
  it('الاسم القصير يبقى ثابتاً بلا تكرار', () => {
    const restore = mockMeasurements(300, 120);
    try {
      render(<OverflowMarquee as="h1" text="مكتب الرافدين" data-testid="name" />);
      const element = screen.getByTestId('name');
      expect(element.getAttribute('data-marquee')).toBe('static');
      expect(element.textContent).toBe('مكتب الرافدين');
      expect(element.getAttribute('title')).toBe('مكتب الرافدين');
    } finally {
      restore();
    }
  });

  it('الاسم الأطول من مساحته يتحرك بحركة مستمرة واتجاه عربي (يمين ← يسار)', () => {
    const restore = mockMeasurements(200, 520);
    try {
      render(
        <div dir="rtl">
          <OverflowMarquee as="h1" text="مكتب الرافدين للتجارة الزراعية العامة والمواد الأولية" speed={40} gap={48} data-testid="name" />
        </div>
      );
      const element = screen.getByTestId('name');
      expect(element.getAttribute('data-marquee')).toBe('moving');
      expect(element.classList.contains('is-overflowing')).toBe(true);
      const track = element.querySelector('.office-marquee-track') as HTMLElement;
      // المسافة = عرض النص + الفراغ، وموجبة في الاتجاه العربي (الحركة نحو اليمين)
      expect(track.style.getPropertyValue('--marquee-distance')).toBe('568px');
      // سرعة ثابتة: 568 بكسل ÷ 40 بكسل/ثانية = 14.2 ثانية للدورة
      expect(track.style.getPropertyValue('--marquee-duration')).toBe('14.20s');
      // النسخة المكررة مخفية عن قارئات الشاشة: الاسم يُقرأ مرة واحدة
      const copies = element.querySelectorAll('.office-marquee-copy');
      expect(copies).toHaveLength(1);
      expect(copies[0].getAttribute('aria-hidden')).toBe('true');
    } finally {
      restore();
    }
  });

  it('في سياق يسار ← يمين تكون الحركة في الاتجاه المعاكس', () => {
    const restore = mockMeasurements(200, 520);
    try {
      render(
        <div dir="ltr">
          <OverflowMarquee text="A very long office name" gap={48} data-testid="name" />
        </div>
      );
      const track = screen.getByTestId('name').querySelector('.office-marquee-track') as HTMLElement;
      expect(track.style.getPropertyValue('--marquee-distance')).toBe('-568px');
    } finally {
      restore();
    }
  });

  it('يعيد القياس عند تغيّر الحجم (دوران الشاشة/تكبير النافذة)', () => {
    let widths = { container: 200, text: 520 };
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('office-marquee') ? widths.container : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('office-marquee-text') ? widths.text : 0;
      }
    });
    try {
      render(<OverflowMarquee text="اسم طويل جداً للمكتب" data-testid="name" />);
      expect(screen.getByTestId('name').getAttribute('data-marquee')).toBe('moving');
      widths = { container: 900, text: 520 }; // النافذة كُبّرت فصار الاسم يتسع
      act(() => observers.forEach((callback) => callback()));
      expect(screen.getByTestId('name').getAttribute('data-marquee')).toBe('static');
    } finally {
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
    }
  });
});

describe('حوار التأكيد داخل التطبيق (بديل confirm/prompt)', () => {
  it('يعيد true عند التأكيد و false عند الإلغاء، بأزرار عربية', async () => {
    render(<ConfirmDialogHost />);
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirmDialog({ title: 'حذف الفاتورة؟', message: 'سيتم إرجاع الكميات', confirmText: 'حذف', tone: 'danger' });
    });
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(screen.getByText('سيتم إرجاع الكميات')).toBeTruthy();
    expect(hasOpenModal()).toBe(true);
    fireEvent.click(screen.getByText('حذف'));
    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    act(() => {
      result = confirmDialog({ title: 'متابعة؟' });
    });
    fireEvent.click(await screen.findByText('إلغاء'));
    await expect(result).resolves.toBe(false);
  });

  it('Escape وزر الرجوع يُلغيان (لا حذف بالخطأ)', async () => {
    render(<ConfirmDialogHost />);
    let result: Promise<boolean> = Promise.resolve(true);
    act(() => {
      result = confirmDialog({ title: 'حذف جميع الإشعارات؟' });
    });
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(result).resolves.toBe(false);
  });

  it('العمليات الخطيرة تتطلب كتابة النص حرفياً (بديل prompt غير المدعوم على ويندوز)', async () => {
    render(<ConfirmDialogHost />);
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirmDialog({ title: 'حذف جميع البيانات؟', confirmText: 'حذف نهائي', requireText: 'حذف نهائي', tone: 'danger' });
    });
    const confirmButton = (await screen.findAllByRole('button', { name: 'حذف نهائي' }))[0] as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('اكتب حذف نهائي للتأكيد'), { target: { value: 'حذف' } });
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('اكتب حذف نهائي للتأكيد'), { target: { value: 'حذف نهائي' } });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);
    await expect(result).resolves.toBe(true);
  });

  it('الطلبات المتزامنة تُعرض بالترتيب واحداً تلو الآخر', async () => {
    render(<ConfirmDialogHost />);
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = confirmDialog({ title: 'السؤال الأول' });
      second = confirmDialog({ title: 'السؤال الثاني' });
    });
    expect(await screen.findByText('السؤال الأول')).toBeTruthy();
    expect(screen.queryByText('السؤال الثاني')).toBeNull();
    fireEvent.click(screen.getByText('تأكيد'));
    await expect(first).resolves.toBe(true);
    expect(await screen.findByText('السؤال الثاني')).toBeTruthy();
    fireEvent.click(screen.getByText('إلغاء'));
    await expect(second).resolves.toBe(false);
  });

  it('بلا مكوّن عرض مركّب: رفض آمن بدل تنفيذ العملية أو حوار أصلي إنجليزي', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(confirmDialog({ title: 'حذف؟' })).resolves.toBe(false);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});

describe('موضع التمرير عند التنقّل (مثل التطبيقات الأصلية)', () => {
  it('صفحة جديدة تبدأ من الأعلى، والرجوع يعيد موضع الصفحة السابقة', async () => {
    const { MemoryRouter, Routes, Route, useNavigate } = await import('react-router-dom');
    const { ScrollManager } = await import('@/components/ScrollManager');
    const calls: number[] = [];
    const scrollTo = vi.fn((options: ScrollToOptions | number) => {
      calls.push(typeof options === 'number' ? 0 : options.top ?? 0);
    });
    vi.stubGlobal('scrollTo', scrollTo);
    let navigate: ReturnType<typeof useNavigate> = () => undefined;
    const Capture = () => {
      navigate = useNavigate();
      return null;
    };
    render(
      <MemoryRouter initialEntries={['/list']}>
        <ScrollManager />
        <Capture />
        <Routes>
          <Route path="/list" element={<p>القائمة</p>} />
          <Route path="/details" element={<p>التفاصيل</p>} />
        </Routes>
      </MemoryRouter>
    );
    // المستخدم يمرّر القائمة إلى الموضع 640
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 40));

    calls.length = 0;
    act(() => navigate('/details'));
    expect(await screen.findByText('التفاصيل')).toBeTruthy();
    expect(calls[0]).toBe(0);

    calls.length = 0;
    act(() => navigate(-1));
    expect(await screen.findByText('القائمة')).toBeTruthy();
    expect(calls[0]).toBe(640);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});
