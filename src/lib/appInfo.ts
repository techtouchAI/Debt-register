/**
 * معلومات الإصدار — مصدرها الوحيد `package.json` (تُحقن وقت البناء عبر
 * `define` في vite.config.ts)، فلا يتباعد الرقم المعروض في الواجهة ولا
 * المكتوب داخل النسخ الاحتياطية عن رقم الإصدار الفعلي.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.0';
