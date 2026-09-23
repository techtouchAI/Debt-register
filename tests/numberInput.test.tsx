import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberInput, NumericTextInput } from '@/components/ui/number-input';
import {
  caretAfterSanitize,
  formatNumberText,
  parseNumberText,
  sanitizeNumberText,
  textMatchesValue
} from '@/lib/numberInput';
import { hashPin, isValidPin, verifyPin } from '@/lib/security';

/**
 * حقول الأرقام: الكتابة فوق التحديد، المسح، الأرقام العربية، ومزامنة القيمة.
 *
 * السبب الجذري للمشكلة التي أبلغ عنها المستخدم ("أحدد النص وأكتب فيُكتب
 * بجانبه"): حقول `type="number"` لا تدعم واجهات التحديد إطلاقاً — في jsdom
 * كما في WebView أندرويد يرمي `setSelectionRange` استثناء InvalidStateError.
 */

afterEach(() => cleanup());

describe('تحليل نص الأرقام', () => {
  it('يحوّل الأرقام العربية والفارسية ويقبل فاصلة عشرية واحدة', () => {
    expect(sanitizeNumberText('١٢٣٫٥')).toBe('123.5');
    expect(sanitizeNumberText('۴۵۶')).toBe('456');
    expect(sanitizeNumberText('1,5')).toBe('1.5');
    expect(sanitizeNumberText('1.2.3')).toBe('1.23');
    expect(sanitizeNumberText('١٬٠٠٠ د.ع')).toBe('1000.');
    expect(sanitizeNumberText('12.5', { allowDecimal: false })).toBe('125');
    expect(sanitizeNumberText('-5')).toBe('5');
  });

  it('الحقل الفارغ أو غير المكتمل قيمته null وليس صفراً', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('.')).toBeNull();
    expect(parseNumberText('5.')).toBe(5);
    expect(parseNumberText('0.25')).toBe(0.25);
  });

  it('العرض بلا صيغة علمية ولا فواصل، ويطابق النص الجاري', () => {
    expect(formatNumberText(1_000_000_000_000)).toBe('1000000000000');
    expect(formatNumberText(null)).toBe('');
    expect(formatNumberText(Number.NaN)).toBe('');
    expect(textMatchesValue('5.', 5)).toBe(true);
    expect(textMatchesValue('05', 5)).toBe(true);
    expect(textMatchesValue('', null)).toBe(true);
    expect(textMatchesValue('', 0)).toBe(false);
  });

  it('موضع المؤشر يبقى منطقياً بعد حذف الرموز غير المقبولة', () => {
    // "12x|3" ⇒ "12|3"
    expect(caretAfterSanitize('12x3', 3)).toBe(2);
    // التحويل العربي حرفاً بحرف لا يغيّر الموضع
    expect(caretAfterSanitize('١٢٣', 2)).toBe(2);
  });
});

function NumericHarness({ initial = 0 as number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <NumberInput data-testid="field" value={value} onValueChange={setValue} />
      <output data-testid="value">{value === null ? 'null' : String(value)}</output>
      <button type="button" onClick={() => setValue(42)}>external</button>
    </>
  );
}

describe('مكوّن NumberInput', () => {
  it('حقل نصي بلوحة أرقام: يدعم التحديد والاستبدال (عكس type=number)', () => {
    render(<NumericHarness initial={250} />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');

    // تحديد "25" ثم كتابة "7" ⇒ يُستبدل المحدد (هكذا يرسل المتصفح الحدث)
    input.focus();
    expect(() => input.setSelectionRange(0, 2)).not.toThrow();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
    fireEvent.change(input, { target: { value: '70' } });
    expect(input.value).toBe('70');
    expect(screen.getByTestId('value').textContent).toBe('70');
  });

  it('السبب الجذري: حقل type=number القديم لا يسمح بالتحديد أصلاً', () => {
    render(<input data-testid="legacy" type="number" defaultValue="250" />);
    const legacy = screen.getByTestId('legacy') as HTMLInputElement;
    expect(() => legacy.setSelectionRange(0, 2)).toThrow();
  });

  it('المسح يُبقي الحقل فارغاً (لا يعود الصفر) والقيمة null', () => {
    render(<NumericHarness initial={0} />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(screen.getByTestId('value').textContent).toBe('null');
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
  });

  it('يقبل الأرقام العربية ويحافظ على "5." أثناء كتابة الكسر', () => {
    render(<NumericHarness initial={null} />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '٥' } });
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '5.' } });
    expect(input.value).toBe('5.');
    expect(screen.getByTestId('value').textContent).toBe('5');
    fireEvent.change(input, { target: { value: '5.٥' } });
    expect(input.value).toBe('5.5');
    expect(screen.getByTestId('value').textContent).toBe('5.5');
  });

  it('يعرض القيمة الجديدة عندما يغيّرها الأب (تحميل/إعادة ضبط)', () => {
    render(<NumericHarness initial={1} />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('external'));
    expect(input.value).toBe('42');
  });

  it('NumericTextInput يُبقي النص كما يكتبه المستخدم بعد التنظيف', () => {
    function Harness() {
      const [text, setText] = useState('');
      return <NumericTextInput data-testid="text" value={text} onValueChange={setText} />;
    }
    render(<Harness />);
    const input = screen.getByTestId('text') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '١٠٠٠' } });
    expect(input.value).toBe('1000');
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
  });
});

describe('رمز الدخول بالأرقام العربية', () => {
  it('"١٢٣٤" صالح ويطابق "1234" نفسه', async () => {
    expect(isValidPin('١٢٣٤')).toBe(true);
    const stored = await hashPin('١٢٣٤');
    expect(await verifyPin('1234', stored)).toBe(true);
    expect(await verifyPin('۱۲۳۴', stored)).toBe(true);
    expect(await verifyPin('1235', stored)).toBe(false);
  });
});

describe('حارس: لا حقول type="number" في الواجهة', () => {
  it('كل حقول الأرقام تمر عبر NumberInput/NumericTextInput', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.tsx')) {
          const code = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          if (/type=["']number["']/.test(code) || /Number\(e(vent)?\.target\.value\)/.test(code)) offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
