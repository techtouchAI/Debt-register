import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { Building, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fileToBase64 } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import {
  CURRENCY_OPTIONS,
  MAX_ADDRESS_LENGTH,
  MAX_INVOICE_FOOTER_LENGTH,
  MAX_OFFICE_NAME_LENGTH,
  type OfficeProfile,
  type OfficeProfileErrors,
  type OfficeProfileField
} from '@/lib/officeProfile';

/**
 * حقول بيانات المكتب (الترويسة) — مكوّن واحد لمعالج التشغيل الأول وصفحة
 * الإعدادات، فلا تختلف الحقول أو القواعد أو الرسائل بين الشاشتين.
 *
 * مكوّن متحكَّم به بالكامل (controlled): القيمة تأتي من الأب ويُبلَّغ كل تغيير
 * كـ patch لحقل واحد. لا توجد نسخة محلية من النص يمكن أن تُستبدل بقيمة
 * أقدم عند إعادة الرسم.
 *
 * لماذا لا يوجد `maxLength` على الحقول النصية؟
 *   لوحات المفاتيح في أندرويد (Gboard/العربية) تكتب الكلمة كـ "تركيب" (IME
 *   composition) ثم تثبّتها. عند بلوغ `maxlength` يقتطع WebView نص التركيب
 *   نفسه فتختفي الكلمة الجارية أو أحرف منها، وقد تُكرَّر الكلمة عند التثبيت.
 *   الحد يُفرض بالتحقق عند الحفظ مع عدّاد مرئي ورسالة واضحة بدل حذف صامت.
 */

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface OfficeProfileFieldsHandle {
  /** نقل التركيز إلى حقل (يُستخدم لأول حقل خاطئ بعد محاولة الحفظ). */
  focusField: (field: OfficeProfileField) => void;
}

interface OfficeProfileFieldsProps {
  value: OfficeProfile;
  errors: OfficeProfileErrors;
  onChange: (patch: Partial<OfficeProfile>) => void;
  /** بادئة معرّفات الحقول (تمنع تكرار id إن ظهر النموذج مرتين). */
  idPrefix: string;
  autoFocusName?: boolean;
  disabled?: boolean;
  /** حجم مربع الشعار (يختلف بين المعالج والإعدادات). */
  logoColumnClassName?: string;
}

interface FieldShellProps {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  counter?: string;
  children: ReactNode;
}

function FieldShell({ id, label, error, hint, counter, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium mb-1 flex items-center gap-1.5">
        {label}
      </label>
      {children}
      {(error || hint || counter) && (
        <div id={`${id}-help`} className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          {error ? (
            <span className="text-red-600 dark:text-red-400 font-medium" role="alert">
              {error}
            </span>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">{hint}</span>
          )}
          {counter && <span className="text-gray-400 dark:text-gray-500 tabular-nums">{counter}</span>}
        </div>
      )}
    </div>
  );
}

const errorClass = (error?: string) => (error ? 'border-red-400 focus-visible:ring-red-400' : '');

export const OfficeProfileFields = forwardRef<OfficeProfileFieldsHandle, OfficeProfileFieldsProps>(
  function OfficeProfileFields(
    { value, errors, onChange, idPrefix, autoFocusName = false, disabled = false, logoColumnClassName = 'md:w-48' },
    ref
  ) {
    const fieldRefs = useRef<Partial<Record<OfficeProfileField, HTMLInputElement | HTMLSelectElement | null>>>({});

    useImperativeHandle(ref, () => ({
      focusField(field) {
        fieldRefs.current[field]?.focus();
      }
    }));

    const id = (field: string) => `${idPrefix}-${field}`;
    const a11y = (field: OfficeProfileField) => ({
      id: id(field),
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': `${id(field)}-help`,
      'aria-required': true
    });

    const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.warning('ملف غير مدعوم', 'اختر صورة PNG أو JPG');
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        toast.warning('حجم الشعار كبير', 'يجب أن يكون أقل من 2 ميجابايت');
        return;
      }
      try {
        onChange({ logo: await fileToBase64(file) });
      } catch (error) {
        reportError('OfficeProfile.logo', error, 'تعذّر قراءة الصورة');
      }
    };

    return (
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-4">
          <FieldShell
            id={id('officeName')}
            label={
              <>
                <Building className="w-4 h-4 text-primary-600" />
                اسم المكتب *
              </>
            }
            error={errors.officeName}
            hint="يُحفظ الاسم كاملاً ويظهر في التخطيط والفواتير واسم ملف النسخة الاحتياطية"
            counter={`${value.officeName.length}/${MAX_OFFICE_NAME_LENGTH}`}
          >
            <Input
              ref={(node) => {
                fieldRefs.current.officeName = node;
              }}
              {...a11y('officeName')}
              value={value.officeName}
              onChange={(e) => onChange({ officeName: e.target.value })}
              placeholder="اكتب اسم مكتبك هنا — مثلاً: مكتب الرافدين"
              className={`h-11 text-base ${errorClass(errors.officeName)}`}
              autoFocus={autoFocusName}
              autoComplete="organization"
              enterKeyHint="next"
              disabled={disabled}
              title={value.officeName || undefined}
            />
          </FieldShell>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldShell id={id('phone')} label="رقم الهاتف *" error={errors.phone} hint="أرقام فقط — تُقبل الأرقام العربية أيضاً">
              <Input
                ref={(node) => {
                  fieldRefs.current.phone = node;
                }}
                {...a11y('phone')}
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                enterKeyHint="next"
                value={value.phone}
                onChange={(e) => onChange({ phone: e.target.value })}
                placeholder="07xxxxxxxxx"
                className={`text-left ${errorClass(errors.phone)}`}
                disabled={disabled}
              />
            </FieldShell>

            <FieldShell id={id('currency')} label="العملة *" error={errors.currency}>
              <select
                ref={(node) => {
                  fieldRefs.current.currency = node;
                }}
                {...a11y('currency')}
                value={value.currency}
                onChange={(e) => onChange({ currency: e.target.value })}
                disabled={disabled}
                className={`flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm ${errorClass(errors.currency)}`}
              >
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FieldShell>
          </div>

          <FieldShell
            id={id('address')}
            label="العنوان *"
            error={errors.address}
            counter={`${value.address.length}/${MAX_ADDRESS_LENGTH}`}
          >
            <Input
              ref={(node) => {
                fieldRefs.current.address = node;
              }}
              {...a11y('address')}
              value={value.address}
              onChange={(e) => onChange({ address: e.target.value })}
              placeholder="المحافظة - المنطقة - الشارع"
              autoComplete="street-address"
              enterKeyHint="next"
              className={errorClass(errors.address)}
              disabled={disabled}
            />
          </FieldShell>

          <FieldShell
            id={id('invoiceFooter')}
            label="تذييل الفاتورة *"
            error={errors.invoiceFooter}
            hint="يُطبع أسفل كل فاتورة ووصل"
            counter={`${value.invoiceFooter.length}/${MAX_INVOICE_FOOTER_LENGTH}`}
          >
            <Input
              ref={(node) => {
                fieldRefs.current.invoiceFooter = node;
              }}
              {...a11y('invoiceFooter')}
              value={value.invoiceFooter}
              onChange={(e) => onChange({ invoiceFooter: e.target.value })}
              placeholder="شكراً لتعاملكم معنا"
              autoComplete="off"
              enterKeyHint="done"
              className={errorClass(errors.invoiceFooter)}
              disabled={disabled}
            />
          </FieldShell>
        </div>

        <div className={`${logoColumnClassName} flex-shrink-0`}>
          <span className="text-sm font-medium mb-2 flex items-center gap-1">
            <ImageIcon className="w-4 h-4" />
            شعار المكتب (اختياري)
          </span>
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
            {value.logo ? (
              <div className="space-y-3">
                <img src={value.logo} alt="شعار المكتب" className="w-24 h-24 mx-auto rounded-xl object-cover border" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => onChange({ logo: undefined })}
                  disabled={disabled}
                >
                  <Trash2 className="w-3 h-3 ml-1" />
                  حذف الشعار
                </Button>
              </div>
            ) : (
              <div className="py-6">
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-xs text-gray-500 mb-3">ارفع شعار المكتب</p>
                <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs cursor-pointer hover:bg-primary-700 focus-within:ring-2 focus-within:ring-primary-600">
                  <Upload className="w-3 h-3" />
                  اختيار ملف
                  <input type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} disabled={disabled} />
                </label>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">يظهر في الفواتير - أقل من 2MB</p>
        </div>
      </div>
    );
  }
);
