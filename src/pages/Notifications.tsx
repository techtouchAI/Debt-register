import { useEffect, useState } from 'react';
import { Bell, BellRing, Check, Trash2, AlertTriangle, Info, CheckCircle, XCircle, Package, Users, FileText, CreditCard, Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, countUnreadNotifications, createNotification, markAllNotificationsRead } from '@/lib/db';
import { getNotificationPermissionState, isNative, requestNotificationPermission, sendSystemNotification, type NotificationPermissionState } from '@/lib/notify';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDate } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';

export function Notifications() {
  const [filter, setFilter] = useState<'all' | 'unread' | 'warning' | 'info'>('all');
  const [permission, setPermission] = useState<NotificationPermissionState>('prompt');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getNotificationPermissionState().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRequestPermission = async () => {
    if (isRequesting) return;
    setIsRequesting(true);
    try {
      const granted = await requestNotificationPermission();
      setPermission(granted ? 'granted' : await getNotificationPermissionState());
      if (granted) {
        toast.success('تم تفعيل الإشعارات', 'ستصلك تنبيهات النظام خارج التطبيق');
        await sendSystemNotification('تم تفعيل الإشعارات', 'ستصلك تنبيهات المخزون والديون هنا');
      } else {
        toast.warning('لم يُمنح الإذن', 'فعّل الإشعارات من إعدادات الجهاز ثم أعد المحاولة');
      }
    } finally {
      setIsRequesting(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      await createNotification(
        'إشعار تجريبي',
        'هذا إشعار تجريبي من التطبيق — يظهر داخل التطبيق وفي شريط النظام',
        { type: 'info', relatedType: 'system', code: 'test-notification' }
      );
      toast.success('تم إرسال إشعار تجريبي');
    } catch (error) {
      reportError('Notifications.test', error, 'تعذّر إرسال الإشعار التجريبي');
    }
  };

  const notifications = useLiveQuery(async () => {
    let all = await db.notifications.orderBy('createdAt').reverse().toArray();
    if (filter === 'unread') all = all.filter(n => !n.isRead);
    if (filter === 'warning') all = all.filter(n => n.type === 'warning');
    if (filter === 'info') all = all.filter(n => n.type === 'info');
    return all;
  }, [filter]);

  const unreadCount = useLiveQuery(() => countUnreadNotifications(), []) || 0;

  const markAsRead = async (id: number) => {
    try {
      await db.notifications.update(id, { isRead: true });
    } catch (error) {
      reportError('Notifications.read', error, 'تعذّر تحديث الإشعار');
    }
  };

  const markAllAsRead = async () => {
    try {
      await markAllNotificationsRead();
      toast.success('تم تحديد كل الإشعارات كمقروءة');
    } catch (error) {
      reportError('Notifications.readAll', error, 'تعذّر تحديث الإشعارات');
    }
  };

  const deleteNotification = async (id: number) => {
    try {
      await db.notifications.delete(id);
    } catch (error) {
      reportError('Notifications.delete', error, 'تعذّر حذف الإشعار');
    }
  };

  const clearAll = async () => {
    if (!confirm('هل أنت متأكد من حذف جميع الإشعارات؟')) return;
    try {
      await db.notifications.clear();
      toast.success('تم حذف جميع الإشعارات');
    } catch (error) {
      reportError('Notifications.clear', error, 'تعذّر حذف الإشعارات');
    }
  };

  const getIcon = (type: string, relatedType?: string) => {
    if (relatedType === 'material') return Package;
    if (relatedType === 'customer') return Users;
    if (relatedType === 'invoice') return FileText;
    if (relatedType === 'payment') return CreditCard;
    
    switch (type) {
      case 'warning': return AlertTriangle;
      case 'success': return CheckCircle;
      case 'error': return XCircle;
      default: return Info;
    }
  };

  const getColor = (type: string) => {
    switch (type) {
      case 'warning': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 border-amber-200 dark:border-amber-800/30';
      case 'success': return 'bg-green-100 dark:bg-green-900/30 text-green-600 border-green-200 dark:border-green-800/30';
      case 'error': return 'bg-red-100 dark:bg-red-900/30 text-red-600 border-red-200 dark:border-red-800/30';
      default: return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 border-blue-200 dark:border-blue-800/30';
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="w-7 h-7 text-primary-600" />
            الإشعارات
            {unreadCount > 0 && <Badge variant="destructive" className="mr-2">{unreadCount} جديد</Badge>}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">تنبيهات النظام - داخل التطبيق وخارجه (Android/Windows)</p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && <Button variant="outline" size="sm" onClick={markAllAsRead}><Check className="w-4 h-4 ml-1" />تحديد الكل كمقروء</Button>}
          <Button variant="outline" size="sm" onClick={clearAll} className="text-red-600"><Trash2 className="w-4 h-4 ml-1" />حذف الكل</Button>
        </div>
      </div>

      <Card className="border-0 shadow-md overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${permission === 'granted' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'}`}>
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm">إشعارات النظام {isNative() ? '(أندرويد)' : ''}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {permission === 'granted'
                    ? 'مفعّلة — تصلك التنبيهات في شريط النظام حتى خارج التطبيق'
                    : permission === 'denied'
                      ? 'مرفوضة — فعّلها من إعدادات الجهاز ثم أعد المحاولة'
                      : permission === 'unsupported'
                        ? 'غير مدعومة على هذه المنصة — ستعمل التنبيهات داخل التطبيق فقط'
                        : 'غير مفعّلة — فعّلها لتصلك التنبيهات خارج التطبيق'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {permission !== 'granted' && permission !== 'unsupported' && (
                <Button size="sm" onClick={handleRequestPermission} disabled={isRequesting} className="bg-primary-600 hover:bg-primary-700">
                  <BellRing className="w-4 h-4 ml-1" />
                  {isRequesting ? 'جاري الطلب…' : 'تفعيل الإشعارات'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleTestNotification}>
                <Send className="w-4 h-4 ml-1" />
                إشعار تجريبي
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex gap-2 flex-wrap">
            <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>الكل ({notifications?.length || 0})</Button>
            <Button variant={filter === 'unread' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('unread')}>غير مقروءة ({unreadCount})</Button>
            <Button variant={filter === 'warning' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('warning')}>تنبيهات</Button>
            <Button variant={filter === 'info' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('info')}>معلومات</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {notifications?.length ? notifications.map((notification) => {
          const Icon = getIcon(notification.type, notification.relatedType);
          return (
            <Card key={notification.id} className={`border-0 shadow-md hover:shadow-lg transition-all ${!notification.isRead ? 'ring-2 ring-primary-200 dark:ring-primary-800/30' : ''}`}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${getColor(notification.type)} flex-shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-bold text-sm flex items-center gap-2">
                          {notification.title}
                          {!notification.isRead && <span className="w-2 h-2 bg-primary-600 rounded-full animate-pulse" />}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{notification.message}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[11px] text-gray-500">{formatDate(notification.createdAt, true)}</span>
                          {notification.relatedType && <Badge variant="outline" className="text-[10px]">{notification.relatedType}</Badge>}
                          <Badge variant={notification.type === 'warning' ? 'warning' : notification.type === 'error' ? 'destructive' : notification.type === 'success' ? 'success' : 'secondary'} className="text-[10px]">{notification.type}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {!notification.isRead && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => markAsRead(notification.id!)}><Check className="w-4 h-4" /></Button>}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => deleteNotification(notification.id!)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        }) : (
          <Card className="border-0 shadow-md">
            <CardContent className="text-center py-16">
              <Bell className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="font-bold mb-2">لا توجد إشعارات</h3>
              <p className="text-sm text-gray-500">سيظهر هنا تنبيهات نفاد المخزون والديون والنسخ الاحتياطي</p>
              <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4 text-xs text-blue-800 dark:text-blue-300 text-right max-w-md mx-auto">
                <p className="font-bold">نظام الإشعارات يعمل:</p>
                <ul className="list-disc pr-4 mt-2 space-y-1">
                  <li>داخل التطبيق: جرس الإشعارات</li>
                  <li>خارج التطبيق: إشعارات منبثقة في Android و Windows</li>
                  <li>تنبيهات تلقائية عند نفاد مادة أو دين كبير</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
