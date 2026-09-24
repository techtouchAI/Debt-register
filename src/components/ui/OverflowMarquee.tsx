import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * نص في سطر واحد يتحرك (شريط متحرك) فقط إذا تجاوز عرض مساحته.
 *
 * - النص القصير يبقى ثابتاً كما هو.
 * - النص الأطول من مساحته يتحرك حركة مستمرة سلسة بعد توقف قصير عند بدايته
 *   (1.5 ثانية)، بسرعة ثابتة مهما طال الاسم، واتجاه الحركة يتبع اتجاه النص
 *   (يمين ← يسار للعربية) فيُقرأ من أوله.
 * - مرور الفأرة أو التركيز يوقف الحركة (قراءة مريحة على ويندوز)، والتلميح
 *   (title) يعرض النص كاملاً.
 * - احترام إعداد "تقليل الحركة" في النظام: يلتف النص كاملاً بدل الحركة.
 * - القياس يُعاد عند تغيّر الحجم (دوران الشاشة، تكبير النافذة) وعند اكتمال
 *   تحميل الخط، لأن عرض النص يتغيّر بعدهما.
 */
interface OverflowMarqueeProps {
  text: string;
  /** أصناف العنصر الخارجي (حجم الخط، اللون...) */
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
  /** السرعة بالبكسل في الثانية */
  speed?: number;
  /** المسافة بين نهاية النص وبداية تكراره (بكسل) */
  gap?: number;
  'data-testid'?: string;
}

export function OverflowMarquee({
  text,
  className,
  as: Tag = 'span',
  speed = 40,
  gap = 48,
  'data-testid': testId
}: OverflowMarqueeProps) {
  const outerRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [metrics, setMetrics] = useState<{ overflow: boolean; distance: number; rtl: boolean }>({
    overflow: false,
    distance: 0,
    rtl: true
  });

  const measure = useCallback(() => {
    const outer = outerRef.current;
    const inner = textRef.current;
    if (!outer || !inner) return;
    const available = outer.clientWidth;
    const needed = inner.scrollWidth;
    const overflow = available > 0 && needed > available + 1;
    // الاتجاه من أقرب سمة dir (التطبيق يضبطها صراحة: <html dir="rtl">)، ثم
    // من الأنماط المحسوبة إن لم توجد سمة
    const dirAttribute = outer.closest('[dir]')?.getAttribute('dir')?.toLowerCase();
    const rtl = dirAttribute
      ? dirAttribute === 'rtl'
      : typeof window !== 'undefined' && window.getComputedStyle(outer).direction === 'rtl';
    const distance = overflow ? Math.ceil(needed + gap) : 0;
    setMetrics((current) =>
      current.overflow === overflow && current.distance === distance && current.rtl === rtl ? current : { overflow, distance, rtl }
    );
  }, [gap]);

  useLayoutEffect(() => {
    measure();
    const outer = outerRef.current;
    const inner = textRef.current;
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && outer && inner) {
      observer = new ResizeObserver(() => measure());
      observer.observe(outer);
      observer.observe(inner);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }
    // الخط المدمج قد يكتمل تحميله بعد أول رسم فيتغيّر عرض النص
    let cancelled = false;
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    void fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
    };
  }, [measure, text]);

  const moving = metrics.overflow && metrics.distance > 0;
  // زمن الدورة = المسافة ÷ السرعة: سرعة قراءة ثابتة للأسماء القصيرة والطويلة
  const duration = moving ? metrics.distance / Math.max(10, speed) : 0;
  const trackStyle = moving
    ? ({
        '--marquee-distance': `${metrics.rtl ? metrics.distance : -metrics.distance}px`,
        '--marquee-duration': `${duration.toFixed(2)}s`
      } as CSSProperties)
    : undefined;

  return (
    <Tag
      ref={outerRef as never}
      className={cn('office-marquee', moving && 'is-overflowing', className)}
      title={text}
      data-testid={testId}
      data-marquee={moving ? 'moving' : 'static'}
    >
      <span className="office-marquee-track" style={trackStyle}>
        <span ref={textRef} className="office-marquee-text">
          {text}
        </span>
        {moving && (
          <span className="office-marquee-text office-marquee-copy" aria-hidden="true" style={{ paddingInlineStart: `${gap}px` }}>
            {text}
          </span>
        )}
      </span>
    </Tag>
  );
}
