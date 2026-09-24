/**
 * منع "فتح" الملفات المسحوبة فوق نافذة التطبيق.
 *
 * السلوك الافتراضي للمتصفح (وللنسخة المكتبية على ويندوز) عند إفلات ملف فوق
 * النافذة هو الانتقال إليه وعرضه — فيختفي التطبيق وتظهر صفحة بيضاء فيها محتوى
 * الملف. هنا يُلغى ذلك في كل مكان، وتبقى مناطق الإفلات المقصودة (مثل استيراد
 * نسخة احتياطية بالسحب والإفلات) تعمل لأنها تعالج الحدث وتلغيه قبل وصوله هنا.
 */
let installed = false;

function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes('Files'));
}

export function installDropGuard(): () => void {
  if (installed || typeof window === 'undefined') return () => undefined;
  installed = true;

  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event) || event.defaultPrevented) return;
    // خارج مناطق الإفلات: مؤشر "غير مسموح" بدل إيحاء بأن الإفلات سيفعل شيئاً
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault();
  };

  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
    installed = false;
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
