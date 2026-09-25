import * as React from 'react';
import { cn } from '@/lib/utils';

interface CartCellProps {
  /** عنوان الحقل — يظهر على الجوال فقط (رأس الجدول يغطّيه على الشاشات الأوسع). */
  label: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * خلية حقل رقمي في سطر بسلة المواد (الفواتير).
 *
 * الخطر الذي تعالجه: الأعمدة الرقمية في جدول من 12 عموداً تضيق على شاشات
 * الهاتف حتى يظهر رقم واحد فقط من السعر أو الكمية (قصّ داخل الحقل). الحل
 * هنا ليس تصغير الخط، بل تغيير التخطيط: السطر يصبح شبكة من عمودين على
 * الجوال (كل حقل يأخذ نصف العرض) ويعود إلى 12 عموداً على `sm` فأعلى، فيحمل
 * كل سطر عنوان حقل، ورأس الجدول يُخفى لأن عنوانه مكرر.
 *
 * العنوان مرئي فقط: الاسم الميسَّر للحقل يأتي من `aria-label` كاملاً
 * («كمية سماد») فلا يعطّل القارئَ الصوتي عنوانٌ ثانٍ أقصر منه.
 */
export function CartCell({ label, className, children }: CartCellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <span aria-hidden="true" className="mb-1 block text-[11px] font-medium text-gray-500 sm:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}
