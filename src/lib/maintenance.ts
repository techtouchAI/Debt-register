import { logBackgroundFailure } from './lifecycle';
import { db, getMeta, setMeta } from './db'
import { reallocateCustomerInvoices } from './invoices'
import { hashPin, isHashedPin } from './security'

/**
 * صيانة دورية لقاعدة البيانات تُنفَّذ عند بدء التطبيق.
 * كل إجراء مُعلَّم بمفتاح في جدول meta حتى لا يتكرر بلا داعٍ.
 */

/** نسخة مصالحة الأرصدة — تُرفع عند تغيير خوارزمية التوزيع. */
const ALLOCATION_FIXUP_VERSION = 'allocation-v1'

/** نسخة تحويل رموز الدخول إلى بصمات مشفّرة. */
const PIN_HASH_FIXUP_VERSION = 'pin-hash-v1'

const MAX_ACTIVITY_LOGS = 500
const MAX_NOTIFICATIONS = 300
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * إعادة توزيع المسددات على كل الفواتير الآجلة مرة واحدة.
 * يُصلح أي تعارض قديم بين "المتبقي" المخزن على الفاتورة والتسديدات الفعلية.
 */
export async function reconcileAllInvoices(): Promise<number> {
  const customerIds = new Set<number>()
  await db.invoices.where('type').equals('credit').each((invoice) => {
    if (typeof invoice.customerId === 'number') customerIds.add(invoice.customerId)
  })

  let processed = 0
  for (const customerId of customerIds) {
    await reallocateCustomerInvoices(customerId)
    processed += 1
  }
  return processed
}

/** قص السجلات التاريخية حتى لا يتضخم الجدول ويبطئ الاستعلامات مع مرور السنين. */
export async function pruneHistory(): Promise<void> {
  const activityKeys = await db.activityLogs.orderBy('id').reverse().primaryKeys()
  const staleActivity = activityKeys.slice(MAX_ACTIVITY_LOGS)
  if (staleActivity.length) await db.activityLogs.bulkDelete(staleActivity)

  const notificationKeys = await db.notifications.orderBy('id').reverse().primaryKeys()
  const staleNotifications = notificationKeys.slice(MAX_NOTIFICATIONS)
  if (staleNotifications.length) await db.notifications.bulkDelete(staleNotifications)

  const backupKeys = await db.backups.orderBy('date').reverse().primaryKeys()
  const staleBackups = backupKeys.slice(200)
  if (staleBackups.length) await db.backups.bulkDelete(staleBackups)
}

export async function runStartupMaintenance(): Promise<void> {
  try {
    const allocationVersion = await getMeta<string>('allocationFixup')
    if (allocationVersion !== ALLOCATION_FIXUP_VERSION) {
      await reconcileAllInvoices()
      await setMeta('allocationFixup', ALLOCATION_FIXUP_VERSION)
    }

    const pinFixup = await getMeta<string>('pinHashFixup')
    if (pinFixup !== PIN_HASH_FIXUP_VERSION) {
      const legacyUsers = (await db.users.toArray()).filter((user) => user.pin && !isHashedPin(user.pin))
      for (const user of legacyUsers) {
        if (user.id === undefined) continue
        await db.users.update(user.id, { pin: await hashPin(user.pin) })
      }
      await setMeta('pinHashFixup', PIN_HASH_FIXUP_VERSION)
    }

    const lastPrune = await getMeta<number>('lastPrune')
    const now = Date.now()
    if (!lastPrune || now - lastPrune >= PRUNE_INTERVAL_MS) {
      await pruneHistory()
      await setMeta('lastPrune', now)
    }
  } catch (error) {
    // الصيانة تحسين وليست شرطاً لعمل التطبيق
    logBackgroundFailure('تعذّر إتمام صيانة قاعدة البيانات:', error)
  }
}
