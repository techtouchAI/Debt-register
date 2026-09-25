/**
 * صلاحيات المستخدمين (نظام محلي بالكامل — بلا إنترنت).
 *
 * دوران ثابتان كما يعرضهما التطبيق:
 *   - مدير: كل شيء (إضافة وتعديل وحذف، الإعدادات، المستخدمون، النسخ، التقارير).
 *   - موظف مبيعات: البيع فقط — إنشاء فواتير البيع وطباعتها، استلام تسديدات
 *     الديون، إضافة زبون جديد أثناء البيع، والاطلاع (قراءة فقط) على المخزن
 *     والزبائن وكشوفهم. لا تعديل ولا حذف لأي سجل أو
 *     التقارير أو النسخ الاحتياطي أو الإعدادات، ولا يرى تكاليف المخزون والأرباح.
 *
 * مصفوفة واحدة هي مصدر الحقيقة: تستخدمها القائمة الجانبية وحراسة المسارات
 * وإظهار الأزرار، وتستخدمها طبقة البيانات أيضاً (دفاع ثانٍ) فلا يمكن تنفيذ
 * عملية ممنوعة حتى لو وصل إليها المستخدم بطريق غير متوقع.
 */
import type { User } from '@/types';

export type Role = User['role'];

export type Permission =
  | 'dashboard.view'
  | 'sales.create'
  | 'invoices.view'
  | 'invoices.edit'
  | 'invoices.delete'
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'customers.delete'
  | 'payments.view'
  | 'payments.create'
  | 'payments.delete'
  | 'materials.view'
  | 'materials.manage'
  | 'reports.view'
  | 'profits.view'
  | 'backup.manage'
  | 'settings.manage'
  | 'users.manage'
  | 'notifications.view'
  | 'notifications.manage';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'sales.create',
  'invoices.view',
  'invoices.edit',
  'invoices.delete',
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.delete',
  'payments.view',
  'payments.create',
  'payments.delete',
  'materials.view',
  'materials.manage',
  'reports.view',
  'profits.view',
  'backup.manage',
  'settings.manage',
  'users.manage',
  'notifications.view',
  'notifications.manage'
];

const SALES_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'dashboard.view',
  'sales.create',
  'invoices.view',
  'customers.view',
  'customers.create',
  'payments.view',
  'payments.create',
  'materials.view',
  'notifications.view'
]);

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL_PERMISSIONS),
  sales: SALES_PERMISSIONS
};

/** هل تملك الصلاحية؟ الدور غير المعروف يُعامل كأقل صلاحية (موظف مبيعات). */
export function roleCan(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (ROLE_PERMISSIONS[role] ?? SALES_PERMISSIONS).has(permission);
}

/** رسالة عربية موحّدة عند رفض عملية لعدم الصلاحية. */
export const PERMISSION_DENIED_MESSAGE = 'لا تملك صلاحية تنفيذ هذه العملية. اطلب ذلك من مدير النظام.';

/** خطأ رفض الصلاحية — يُرمى من طبقة البيانات ويُعرض برسالة عربية. */
export class PermissionDeniedError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(PERMISSION_DENIED_MESSAGE);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
  }
}

/** صلاحية كل مسار (للقائمة الجانبية وحراسة المسارات). */
export function routePermission(pathname: string): Permission {
  if (pathname === '/' || pathname === '') return 'dashboard.view';
  if (pathname === '/invoices/new') return 'sales.create';
  if (/^\/invoices\/[^/]+\/edit$/.test(pathname)) return 'invoices.edit';
  if (pathname.startsWith('/invoices')) return 'invoices.view';
  if (pathname.startsWith('/customers')) return 'customers.view';
  if (pathname === '/payments/new') return 'payments.create';
  if (pathname.startsWith('/payments')) return 'payments.view';
  if (pathname.startsWith('/materials')) return 'materials.view';
  if (pathname.startsWith('/reports')) return 'reports.view';
  if (pathname.startsWith('/backup')) return 'backup.manage';
  if (pathname.startsWith('/settings')) return 'settings.manage';
  if (pathname.startsWith('/notifications')) return 'notifications.view';
  return 'dashboard.view';
}
