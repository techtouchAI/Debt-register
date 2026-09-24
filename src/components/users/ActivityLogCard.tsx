import { useState } from 'react';
import { History } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { formatDocumentNumber } from '@/lib/labels';
import { formatDate } from '@/lib/utils';

/**
 * سجل النشاط (للمدير): من فعل ماذا ومتى — تسجيل الدخول والخروج، الفواتير،
 * التسديدات، التعديلات والحذف. كل إدخال منسوب للمستخدم الذي كان مسجّلاً.
 */
const PAGE_SIZE = 30;

/** أرقام المستندات القديمة داخل نص السجل تُعرض بالبادئة العربية أيضاً. */
function localizeDetails(details: string): string {
  return details.replace(/\b(?:INV|REC|PUR)-[\w-]+/g, (match) => formatDocumentNumber(match));
}

export function ActivityLogCard() {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const logs = useLiveQuery(() => db.activityLogs.orderBy('id').reverse().limit(limit).toArray(), [limit]);
  const total = useLiveQuery(() => db.activityLogs.count(), []) ?? 0;

  return (
    <Card className="border-0 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-5 h-5" />
          سجل النشاط
        </CardTitle>
        <p className="text-xs text-gray-500">آخر العمليات مع اسم المستخدم الذي نفّذها</p>
      </CardHeader>
      <CardContent>
        {logs?.length ? (
          <ul className="space-y-2 max-h-96 overflow-y-auto overscroll-contain" data-testid="activity-log">
            {logs.map((log) => (
              <li key={log.id} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-900 dark:text-white">{log.action}</span>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">{formatDate(log.timestamp, true)}</span>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mt-0.5 break-words">{localizeDetails(log.details)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{log.userName ? `بواسطة: ${log.userName}` : 'بواسطة: النظام'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-sm text-gray-500 py-6">لا توجد عمليات مسجّلة بعد</p>
        )}
        {logs && logs.length < total && (
          <Button variant="outline" size="sm" className="w-full mt-3 text-xs" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
            عرض المزيد
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
