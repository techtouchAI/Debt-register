/**
 * ملف تعريف المكتب (بيانات الترويسة): قواعد التحقق والتطبيع في مكان واحد.
 *
 * هذه البيانات تُطبع في ترويسة كل فاتورة ووصل، لذلك هي **إلزامية** في
 * التشغيل الأول ولا يمكن تخطيها: الاسم، الهاتف، العملة، العنوان، تذييل
 * الفاتورة. الشعار وحده اختياري.
 *
 * القواعد نفسها تُطبَّق في معالج التشغيل الأول وفي صفحة الإعدادات، ويستخدمها
 * `App` ليقرر هل يجب عرض المعالج (ملف تعريف ناقص ⇒ المعالج)، فلا يوجد
 * مساران مختلفان للتحقق يمكن أن يتباعدا.
 */
import type { OfficeSettings } from '@/types';
import { MAX_OFFICE_NAME_LENGTH, normalizeOfficeName, validateOfficeName } from './officeName';

/** العملات المدعومة — مصدر واحد لقوائم الاختيار والتحقق. */
export const CURRENCY_OPTIONS = [
  { value: 'د.ع', label: 'دينار عراقي (د.ع)' },
  { value: '$', label: '$ دولار أمريكي' },
  { value: 'ر.س', label: 'ريال سعودي' },
  { value: 'ج.م', label: 'جنيه مصري' },
  { value: 'د.أ', label: 'دينار أردني' }
] as const;

export const MAX_ADDRESS_LENGTH = 200;
export const MAX_INVOICE_FOOTER_LENGTH = 200;
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

/** الحقول القابلة للتحرير في ملف تعريف المكتب. */
export interface OfficeProfile {
  officeName: string;
  phone: string;
  currency: string;
  address: string;
  invoiceFooter: string;
  logo?: string;
}

export type OfficeProfileField = Exclude<keyof OfficeProfile, 'logo'>;
export type OfficeProfileErrors = Partial<Record<OfficeProfileField, string>>;

export type OfficeProfileValidation =
  | { ok: true; value: OfficeProfile; errors: OfficeProfileErrors }
  | { ok: false; errors: OfficeProfileErrors };

/** ترتيب الحقول كما تظهر في النموذج (لنقل التركيز لأول حقل خاطئ). */
export const OFFICE_PROFILE_FIELDS: readonly OfficeProfileField[] = [
  'officeName',
  'phone',
  'currency',
  'address',
  'invoiceFooter'
];

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰ (فارسي/أردو)

/**
 * تحويل الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) إلى أرقام لاتينية.
 * لوحة المفاتيح العربية في أندرويد تكتب ٠٧٨٠… افتراضياً، ورفض هذه الأرقام أو
 * حفظها كما هي كان يُنتج أرقام هواتف لا تُطبع ولا يُتصل بها.
 */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - base);
  });
}

/** تطبيع الهاتف: أرقام لاتينية فقط مع `+` اختيارية في البداية. */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const latin = toLatinDigits(raw).trim();
  const hasPlus = latin.startsWith('+');
  const digits = latin.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  return hasPlus ? `+${digits}` : digits;
}

/** تطبيع نص سطر واحد: فراغ خارجي + أسطر متعددة ⇒ مسافة (يمس الترويسة فقط). */
function normalizeLine(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function validatePhone(raw: unknown): { value: string; error?: string } {
  const value = normalizePhone(raw);
  if (!value) return { value, error: 'رقم الهاتف مطلوب' };
  if (!/^\+?\d+$/.test(value)) return { value, error: 'رقم الهاتف يجب أن يحتوي أرقاماً فقط' };
  const digits = value.replace(/^\+/, '').length;
  if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
    return { value, error: `رقم الهاتف يجب أن يكون بين ${MIN_PHONE_DIGITS} و ${MAX_PHONE_DIGITS} رقماً` };
  }
  return { value };
}

function validateRequiredLine(raw: unknown, label: string, max: number): { value: string; error?: string } {
  const value = normalizeLine(raw);
  if (!value) return { value, error: `${label} مطلوب` };
  if (value.length > max) return { value, error: `${label} طويل جداً (الحد ${max} حرفاً)` };
  return { value };
}

/**
 * التحقق من ملف تعريف المكتب كاملاً مع رسالة عربية لكل حقل.
 * عند النجاح تُعاد القيم مطبّعة وجاهزة للحفظ.
 */
export function validateOfficeProfile(input: Partial<Record<keyof OfficeProfile, unknown>>): OfficeProfileValidation {
  const errors: OfficeProfileErrors = {};

  const name = validateOfficeName(input.officeName);
  if (!name.ok) errors.officeName = name.error ?? 'اسم المكتب مطلوب';

  const phone = validatePhone(input.phone);
  if (phone.error) errors.phone = phone.error;

  const currency = typeof input.currency === 'string' ? input.currency : '';
  if (!CURRENCY_OPTIONS.some((option) => option.value === currency)) errors.currency = 'اختر عملة المكتب';

  const address = validateRequiredLine(input.address, 'العنوان', MAX_ADDRESS_LENGTH);
  if (address.error) errors.address = address.error;

  const footer = validateRequiredLine(input.invoiceFooter, 'تذييل الفاتورة', MAX_INVOICE_FOOTER_LENGTH);
  if (footer.error) errors.invoiceFooter = footer.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors,
    value: {
      officeName: name.value,
      phone: phone.value,
      currency,
      address: address.value,
      invoiceFooter: footer.value,
      logo: typeof input.logo === 'string' && input.logo ? input.logo : undefined
    }
  };
}

/** هل بيانات الترويسة مكتملة؟ (ناقصة ⇒ يُعرض معالج التشغيل الأول) */
export function isOfficeProfileComplete(settings: Partial<OfficeSettings> | null | undefined): boolean {
  if (!settings) return false;
  return validateOfficeProfile(settings).ok;
}

/** استخراج حقول ملف التعريف من الإعدادات المحفوظة (قيم نصية دائماً). */
export function profileFromSettings(settings: Partial<OfficeSettings> | null | undefined): OfficeProfile {
  return {
    officeName: settings?.officeName ?? '',
    phone: settings?.phone ?? '',
    currency: settings?.currency || CURRENCY_OPTIONS[0].value,
    address: settings?.address ?? '',
    invoiceFooter: settings?.invoiceFooter ?? '',
    logo: settings?.logo || undefined
  };
}

/** أول حقل خاطئ حسب ترتيب النموذج. */
export function firstInvalidField(errors: OfficeProfileErrors): OfficeProfileField | undefined {
  return OFFICE_PROFILE_FIELDS.find((field) => errors[field]);
}

export { MAX_OFFICE_NAME_LENGTH, normalizeOfficeName };
