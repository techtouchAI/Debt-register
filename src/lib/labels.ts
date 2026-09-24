/**
 * النصوص العربية لكل قيمة داخلية تظهر للمستخدم.
 *
 * القاعدة: الواجهة عربية بالكامل — لا تُعرض أي قيمة داخلية (رموز إنجليزية
 * مثل `system` أو `info` أو `cash`) كما هي. كل قيمة تمرّ عبر إحدى دوال هذا
 * الملف، ولكل دالة قيمة احتياطية عربية حتى لو وصلت قيمة غير معروفة (من نسخة
 * احتياطية قديمة أو إصدار أحدث)، فلا يمكن أن يتسرّب نص إنجليزي إلى الشاشة.
 */
import type { Notification as AppNotification, Payment, User } from '@/types';

/* ------------------------------------------------------------------ *
 * الإشعارات
 * ------------------------------------------------------------------ */

const NOTIFICATION_TYPE_LABELS: Record<AppNotification['type'], string> = {
  info: 'معلومة',
  warning: 'تنبيه',
  error: 'خطأ',
  success: 'نجاح'
};

const NOTIFICATION_SOURCE_LABELS: Record<NonNullable<AppNotification['relatedType']>, string> = {
  material: 'المخزن',
  customer: 'الزبائن',
  invoice: 'الفواتير',
  payment: 'التسديدات',
  system: 'النظام'
};

/** نوع الإشعار بالعربية (معلومة/تنبيه/خطأ/نجاح). */
export function notificationTypeLabel(type: unknown): string {
  return typeof type === 'string' && type in NOTIFICATION_TYPE_LABELS
    ? NOTIFICATION_TYPE_LABELS[type as AppNotification['type']]
    : 'معلومة';
}

/** مصدر الإشعار بالعربية (المخزن/الزبائن/الفواتير/التسديدات/النظام). */
export function notificationSourceLabel(source: unknown): string {
  return typeof source === 'string' && source in NOTIFICATION_SOURCE_LABELS
    ? NOTIFICATION_SOURCE_LABELS[source as NonNullable<AppNotification['relatedType']>]
    : 'عام';
}

/* ------------------------------------------------------------------ *
 * المدفوعات والفواتير والمستخدمون
 * ------------------------------------------------------------------ */

const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'نقدي',
  transfer: 'تحويل',
  other: 'أخرى'
};

/** طريقة الدفع بالعربية. */
export function paymentMethodLabel(method: unknown): string {
  return typeof method === 'string' && method in PAYMENT_METHOD_LABELS
    ? PAYMENT_METHOD_LABELS[method as Payment['method']]
    : 'أخرى';
}

/** نوع الفاتورة/وصل الشراء بالعربية. */
export function saleTypeLabel(type: unknown): string {
  return type === 'cash' ? 'نقدي' : 'آجل';
}

const ROLE_LABELS: Record<User['role'], string> = {
  admin: 'مدير',
  sales: 'موظف مبيعات'
};

/** صلاحية المستخدم بالعربية. */
export function roleLabel(role: unknown): string {
  return typeof role === 'string' && role in ROLE_LABELS ? ROLE_LABELS[role as User['role']] : 'موظف مبيعات';
}

/* ------------------------------------------------------------------ *
 * الأحجام
 * ------------------------------------------------------------------ */

/**
 * حجم ملف بوحدات عربية (بايت / ك.ب / م.ب) بدل KB و MB.
 * الأرقام تُكتب بخانة عشرية واحدة كحد أقصى.
 */
export function formatFileSize(bytes: unknown): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 بايت';
  if (value < 1024) return `${Math.round(value)} بايت`;
  const kb = value / 1024;
  if (kb < 1024) return `${trimDecimal(kb)} ك.ب`;
  return `${trimDecimal(kb / 1024)} م.ب`;
}

function trimDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/* ------------------------------------------------------------------ *
 * أرقام المستندات
 * ------------------------------------------------------------------ */

/**
 * بادئات أرقام المستندات الجديدة (عربية): فاتورة بيع، وصل قبض، وصل شراء.
 * تُستخدم في `sequence.ts` عند توليد الأرقام.
 */
export const DOCUMENT_PREFIX = {
  invoice: 'ف',
  receipt: 'ق',
  purchase: 'ش'
} as const;

/** البادئات القديمة (إنجليزية) في البيانات المحفوظة قبل هذا الإصدار. */
export const LEGACY_DOCUMENT_PREFIX = {
  invoice: 'INV',
  receipt: 'REC',
  purchase: 'PUR'
} as const;

const LEGACY_TO_ARABIC: ReadonlyArray<readonly [RegExp, string]> = [
  [/^INV(?=-)/i, DOCUMENT_PREFIX.invoice],
  [/^REC(?=-)/i, DOCUMENT_PREFIX.receipt],
  [/^PUR(?=-)/i, DOCUMENT_PREFIX.purchase]
];

const LEGACY_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-RESTORED-/gi, '-مستعاد-'],
  [/-OLD-/gi, '-قديم-']
];

/**
 * رقم المستند كما يُعرض ويُطبع.
 *
 * الأرقام الجديدة عربية أصلاً (ف-202609-0001). أما الأرقام المحفوظة قبل هذا
 * الإصدار (INV-202609-0001) فتبقى كما هي في قاعدة البيانات — فهي مرجع ورقي
 * بيد الزبائن ولا يجوز تغييرها — لكنها تُعرض بالبادئة العربية المقابلة مع
 * الحفاظ على الأرقام نفسها، فيطابقها الزبون بسهولة مع نسخته الورقية.
 */
export function formatDocumentNumber(value: unknown): string {
  let text = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
  for (const [pattern, arabic] of LEGACY_TO_ARABIC) {
    if (pattern.test(text)) {
      text = text.replace(pattern, arabic);
      break;
    }
  }
  for (const [pattern, arabic] of LEGACY_WORDS) text = text.replace(pattern, arabic);
  return text;
}

/**
 * هل يطابق رقم المستند نص البحث؟ يقبل الصيغة المخزّنة والصيغة المعروضة معاً
 * (من يكتب "ف-2026" يجد الفاتورة القديمة INV-2026 والعكس).
 */
export function documentNumberMatches(value: unknown, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  return raw.includes(needle) || formatDocumentNumber(value).toLowerCase().includes(needle);
}
