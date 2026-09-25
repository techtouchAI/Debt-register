/**
 * يطبّق تفضيل السمة قبل أن ترسم React الواجهة.
 *
 * هذا الملف مستقل عمداً عن نقطة إقلاع React حتى تبقى `index.html` خالية من
 * JavaScript مضمّن. بذلك يعمل Content Security Policy الصارم داخل Electron
 * من دون السماح بـ `unsafe-inline` للسكربتات، وتبقى تجربة بدء التشغيل بلا
 * وميض بين السمة الفاتحة والداكنة.
 */
try {
  const storedTheme = localStorage.getItem('theme')
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const isDark = storedTheme === 'dark' || (!storedTheme && prefersDark)

  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.backgroundColor = isDark ? '#151412' : '#f8f7f5'
} catch {
  // قد تكون مساحة التخزين غير متاحة في بيئة خصوصية مقيّدة؛ تبدأ الواجهة بالسمة الافتراضية.
}
