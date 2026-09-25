import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { db, closeDatabase, initializeDB, openDatabase } from '@/lib/db';
import { resetSettingsStore } from '@/lib/settingsStore';
import { resetModalStackForTests } from '@/lib/modalStack';
import { resetHistoryTrapForTests } from '@/lib/historyTrap';
import { setNativeBackSubscriber } from '@/lib/nativeBridge';
import { resetSessionForTests } from '@/lib/session';
import { cancelAllConfirms } from '@/lib/confirm';
import { closeDocumentPreview } from '@/lib/documentPreview';
import { resetToastsForTests } from '@/lib/toast';

// jsdom لا يطبّق التمرير (يطبع "Not implemented: window.scrollTo" في كل تنقّل)
window.scrollTo = (() => undefined) as typeof window.scrollTo;

// jsdom لا يملك حوار طباعة ولا تركيز إطار. مسار الطباعة في التطبيق يُطلق
// هذين الاستدعاءين عمداً (طباعة عبر إطار بمقاس الورقة)، فلا نريد ضجيج
// "Not implemented" في مخرجات الاختبارات — والاختبارات تتحقق من النتيجة
// السلوكية (هل ظهرت المعاينة البديلة؟) لا من استدعاء المتصفح نفسه.
window.print = (() => undefined) as typeof window.print;

/**
 * بيئة اختبار موحّدة:
 *   - قاعدة IndexedDB وهمية تُفرَّغ قبل كل اختبار حتى لا تتسرّب البيانات.
 *   - الإغلاق يتم عبر `closeDatabase()` الذي يرفع علامة الإغلاق أولاً، فلا
 *     تبقى عملية غير متزامنة تكتب بعد إغلاق القاعدة (سبب تحذير
 *     DatabaseClosedError الذي كان يظهر أحياناً في مخرجات الاختبارات).
 *   - تصفير مكدس النوافذ وفخّ السجل ومستمع الرجوع الأصلي بين الاختبارات.
 */
beforeEach(async () => {
  setNativeBackSubscriber(null);
  // جلسة الدخول وحوارات التأكيد حالة وحدة: تُصفَّر بين الاختبارات
  resetSessionForTests();
  cancelAllConfirms();
  closeDocumentPreview();
  resetToastsForTests();
  resetModalStackForTests();
  resetHistoryTrapForTests();
  // مخزن الإعدادات ذاكرة وحدة، فيجب تصفيره بين الاختبارات كما تُفرَّغ القاعدة
  resetSettingsStore();
  // مسودات النماذج في localStorage يجب ألا تتسرّب بين الاختبارات
  window.localStorage.clear();
  await db.delete();
  await openDatabase();
  await initializeDB();
});

afterEach(async () => {
  // إلغاء تركيب أي واجهة ما زالت مركّبة قبل إغلاق القاعدة: بقاء التطبيق
  // مركّباً بعد آخر اختبار في الملف كان يترك مؤقتات واستعلامات حيّة تُحدّث
  // الحالة بعد تفكيك بيئة jsdom (window is not defined).
  cleanup();
  resetSessionForTests();
  cancelAllConfirms();
  closeDocumentPreview();
  resetModalStackForTests();
  resetHistoryTrapForTests();
  resetSettingsStore();
  setNativeBackSubscriber(null);
  await closeDatabase();
  // مهلة قصيرة تتيح لأي وعد متبقٍّ أن يُرفض قبل بدء الاختبار التالي،
  // فتبقى مخرجات الاختبار نظيفة وقابلة للقراءة.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
