import { describe, expect, it } from 'vitest';
import { formatErrorMessage, getArabicErrorMessage } from '@/lib/errors';
import { formatToastText } from '@/lib/toast';

describe('المهيّئ المركزي لرسائل الأخطاء', () => {
  it('يترجم أخطاء الشبكة والمهلة من Error أو نص مباشر', () => {
    expect(formatErrorMessage(new Error('Network Error'))).toContain('الشبكة');
    expect(formatErrorMessage('timeout')).toContain('الاتصال');
    expect(formatErrorMessage({ message: 'Failed to fetch' })).toContain('الشبكة');
  });

  it('يحوّل الكلمات الإنجليزية الشائعة في الواجهة إلى العربية', () => {
    expect(formatErrorMessage('Error')).toBe('خطأ');
    expect(formatErrorMessage('Ok')).toBe('موافق');
    expect(formatErrorMessage('Cancel')).toBe('إلغاء');
    expect(formatErrorMessage('Success')).toBe('نجاح');
  });

  it('لا يسرّب رسالة إنجليزية غير معروفة إلى المستخدم', () => {
    const message = getArabicErrorMessage('Something went wrong');
    expect(message).toContain('حدث خطأ');
    expect(message).not.toMatch(/[A-Za-z]/);
  });

  it('يترجم التوست دون إفساد أسماء الملفات أو بيانات النجاح', () => {
    expect(formatToastText('Network Error', 'error')).toContain('الشبكة');
    expect(formatToastText('Request failed', 'warning')).toContain('حدث خطأ');
    expect(formatToastText('Office_2026.pdf', 'success')).toBe('Office_2026.pdf');
    expect(formatToastText('Acme Corp', 'success')).toBe('Acme Corp');
  });
});
