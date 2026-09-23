import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { db, closeDatabase, initializeDB, openDatabase } from '@/lib/db';
import { resetModalStackForTests } from '@/lib/modalStack';
import { resetHistoryTrapForTests } from '@/lib/historyTrap';
import { setNativeBackSubscriber } from '@/lib/nativeBridge';

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
  resetModalStackForTests();
  resetHistoryTrapForTests();
  await db.delete();
  await openDatabase();
  await initializeDB();
});

afterEach(async () => {
  resetModalStackForTests();
  resetHistoryTrapForTests();
  setNativeBackSubscriber(null);
  await closeDatabase();
  // مهلة قصيرة تتيح لأي وعد متبقٍّ أن يُرفض قبل بدء الاختبار التالي،
  // فتبقى مخرجات الاختبار نظيفة وقابلة للقراءة.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
