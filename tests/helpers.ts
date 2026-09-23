import { updateSettings } from '@/lib/db';

/**
 * إعداد مكتب مكتمل البيانات (كل حقول الترويسة الإلزامية) حتى يتجاوز التطبيق
 * معالج التشغيل الأول — المعالج يظهر لأي بيانات ناقصة لا للاسم الفارغ فقط.
 */
export async function seedOfficeProfile(officeName = 'مكتب الاختبار الزراعي'): Promise<void> {
  await updateSettings({
    officeName,
    phone: '07801234567',
    currency: 'د.ع',
    address: 'الأنبار - الكرمة',
    invoiceFooter: 'شكراً لتعاملكم معنا'
  });
}

/** تعبئة الحقول الإلزامية الأخرى في معالج التشغيل الأول (الاسم يُعبّأ في الاختبار). */
export function fillRequiredSetupFields(
  change: (element: Element, value: string) => void,
  getById: (id: string) => Element
): void {
  change(getById('setup-phone'), '07801234567');
  change(getById('setup-address'), 'الأنبار - الكرمة');
}
