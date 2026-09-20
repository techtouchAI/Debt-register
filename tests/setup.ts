import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { db, initializeDB } from '@/lib/db';

/**
 * بيئة اختبار موحّدة: قاعدة IndexedDB وهمية تُفرَّغ قبل كل اختبار
 * حتى لا تتسرّب البيانات بين الحالات.
 */
beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDB();
});

afterEach(async () => {
  await db.close();
});
