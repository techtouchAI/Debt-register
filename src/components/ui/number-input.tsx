import * as React from 'react';
import { Input, type InputProps } from '@/components/ui/input';
import {
  caretAfterSanitize,
  formatNumberText,
  parseNumberText,
  sanitizeNumberText,
  textMatchesValue
} from '@/lib/numberInput';

/**
 * حقول الأرقام الموحّدة للتطبيق — تتصرّف كحقل نص عادي أثناء الكتابة.
 *
 * تحلّ مشكلات `<input type="number">` التي كانت تظهر في كل الصفحات:
 *   - **تحديد النص والكتابة فوقه**: حقول number في WebView أندرويد لا تدعم
 *     التحديد (لا مقابض تحديد ولا selectionStart)، فالرقم الجديد يُكتب بجانب
 *     القديم بدل أن يستبدله. هنا الحقل نصّي فيعمل التحديد والاستبدال طبيعياً.
 *   - **المسح يعيد الصفر**: كان `Number('')` يحوّل الحقل الفارغ إلى 0 فوراً.
 *   - **الأرقام العربية** (٠-٩) كان الحقل الرقمي يرفضها بصمت؛ هنا تُحوَّل.
 *   - **قفز المؤشر**: يُعاد المؤشر إلى موضعه المنطقي بعد تنظيف النص.
 *   - `inputMode` يُظهر لوحة الأرقام على الجوال دون قيود حقل number.
 */

type BaseProps = Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode'> & {
  /** السماح بالكسور (افتراضي: نعم). */
  allowDecimal?: boolean;
};

export interface NumericTextInputProps extends BaseProps {
  /** النص كما يكتبه المستخدم (الأب يحفظه كنص ويحلّله عند الحفظ). */
  value: string;
  onValueChange: (text: string) => void;
}

/** حقل رقمي يتحكّم الأب بنصّه مباشرة (للنماذج التي تحفظ القيم كنصوص). */
export const NumericTextInput = React.forwardRef<HTMLInputElement, NumericTextInputProps>(function NumericTextInput(
  { value, onValueChange, allowDecimal = true, dir = 'ltr', ...props },
  forwardedRef
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const pendingCaret = React.useRef<number | null>(null);

  // بعد تنظيف النص (تحويل رقم عربي أو حذف رمز) يعيد React القيمة فيقفز
  // المؤشر لنهاية الحقل؛ نعيده إلى موضعه المنطقي قبل الرسم على الشاشة.
  React.useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const element = innerRef.current;
    pendingCaret.current = null;
    if (caret === null || !element || document.activeElement !== element) return;
    element.setSelectionRange(caret, caret);
  }, [value]);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const options = { allowDecimal };
    const next = sanitizeNumberText(raw, options);
    if (next !== raw) {
      const caret = event.target.selectionStart;
      pendingCaret.current = caret === null ? null : caretAfterSanitize(raw, caret, options);
    }
    onValueChange(next);
  };

  return (
    <Input
      {...props}
      ref={setRefs}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      dir={dir}
      value={value}
      onChange={handleChange}
    />
  );
});

export interface NumberInputProps extends BaseProps {
  value: number | null | undefined;
  /** القيمة الجديدة، أو `null` للحقل الفارغ/غير المكتمل. */
  onValueChange: (value: number | null) => void;
}

/**
 * حقل رقمي يتحكّم الأب بقيمته **الرقمية**.
 *
 * النص يُحفظ محلياً ولا يُستبدل إلا إذا غيّر الأب القيمة من الخارج (تحميل
 * سجل، إعادة ضبط النموذج) — فلا يُكتب أبداً فوق ما يكتبه المستخدم، ويبقى
 * "5." أو الحقل الفارغ كما هو أثناء الكتابة.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, ...props },
  ref
) {
  const [text, setText] = React.useState(() => formatNumberText(value));
  // آخر قيمة استلمناها من الأب — المزامنة تحدث فقط عندما يغيّرها الأب نفسه
  const [previousValue, setPreviousValue] = React.useState(value);

  // مزامنة أثناء الرسم (النمط الموصى به في React بدل تأثير + setState)
  if (!Object.is(value, previousValue)) {
    setPreviousValue(value);
    if (!textMatchesValue(text, value)) setText(formatNumberText(value));
  }

  const handleText = (next: string) => {
    setText(next);
    onValueChange(parseNumberText(next));
  };

  return <NumericTextInput {...props} ref={ref} value={text} onValueChange={handleText} />;
});
