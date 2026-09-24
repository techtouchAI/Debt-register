import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Search, Edit, Trash2, Phone, MapPin, DollarSign, FileText, CreditCard, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings } from '@/lib/db';
import { getCustomerBalances } from '@/lib/debts';
import {
  checkCustomerDeletion,
  deleteCustomer,
  saveCustomer,
  type CustomerDeletionBlock
} from '@/lib/customers';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAsyncScope } from '@/hooks/useAsyncScope';
import { useModalCloser } from '@/hooks/useModalCloser';
import { formatCurrency, roundMoney } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { guard } from '@/lib/errors';
import { confirmDialog } from '@/lib/confirm';
import { usePermission } from '@/hooks/useSession';
import { Customer } from '@/types';

export function Customers() {
  const scope = useAsyncScope();
  const can = usePermission();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<Partial<Customer>>({ fullName: '', phone: '', address: '', notes: '' });

  const settings = useLiveQuery(() => getSettings(), []);

  const customers = useLiveQuery(async () => {
    const all = await db.customers.toArray();
    const query = search.trim().toLowerCase();
    const filtered = query
      ? all.filter(
          (customer) =>
            customer.fullName.toLowerCase().includes(query) ||
            (customer.phone ?? '').includes(query) ||
            (customer.address ?? '').toLowerCase().includes(query)
        )
      : all;
    return filtered.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  }, [search]);

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  useModalCloser(showForm, closeForm);

  // الأرصدة تُحسب بمرور واحد وتتحدث تلقائياً مع أي فاتورة أو تسديد جديد
  const balances = useLiveQuery(() => getCustomerBalances(), []);
  const currency = settings?.currency || 'د.ع';
  const debts: Record<number, number> = {};
  if (balances) {
    for (const [customerId, balance] of balances) debts[customerId] = balance.debt;
  }

  /**
   * الحفظ يمرّ عبر `saveCustomer` (التحقق والقواعد في مكان واحد) وداخل نطاق
   * الشاشة؛ فإن غادر المستخدم الشاشة قبل انتهاء الكتابة أُلغيت العملية بدل
   * تحديث واجهة لم تعد موجودة.
   */
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const editingId = editing?.id;

    await guard(
      'Customers.save',
      async () => {
        const result = await scope.run(() =>
          saveCustomer(
            {
              fullName: formData.fullName ?? '',
              phone: formData.phone,
              address: formData.address,
              notes: formData.notes
            },
            editingId
          )
        );

        if (!result.ok) {
          toast.warning('تحقّق من البيانات', result.error);
          return;
        }

        toast.success(editingId ? 'تم تحديث بيانات الزبون' : 'تمت إضافة الزبون', result.customer.fullName);
        closeForm();
        setFormData({ fullName: '', phone: '', address: '', notes: '' });
      },
      'حدث خطأ أثناء الحفظ'
    );
  };

  const handleEdit = (customer: Customer) => {
    setEditing(customer);
    setFormData(customer);
    setShowForm(true);
  };

  /** صياغة رسالة المنع انطلاقاً من سبب القادم من طبقة العمل. */
  const describeBlock = (block: CustomerDeletionBlock): [string, string] => {
    if (block.reason === 'has-debt') {
      return ['لا يمكن الحذف', `الزبون مدين بمبلغ ${formatCurrency(block.debt, currency)}. يجب تسديد الدين أولاً.`];
    }
    if (block.reason === 'has-records') {
      return [
        'لا يمكن حذف الزبون',
        `لديه ${block.invoices} فاتورة و${block.payments} تسديد. إبقاء السجل يحافظ على سلامة كشف الحساب.`
      ];
    }
    return ['الزبون غير موجود', 'ربما حُذف من نافذة أخرى؛ أعد تحميل القائمة.'];
  };

  const handleDelete = async (customer: Customer) => {
    const customerId = customer.id;
    if (!customerId) return;

    await guard(
      'Customers.delete',
      async () => {
        // فحص أولي لعرض السبب قبل سؤال المستخدم، ثم حذف يعيد الفحص داخل
        // معاملة واحدة، فلا توجد فجوة زمنية بين الفحص والحذف.
        const check = await scope.run(() => checkCustomerDeletion(customerId));
        if (!check.ok) {
          const [title, body] = describeBlock(check);
          toast.warning(title, body);
          return;
        }

        const confirmed = await confirmDialog({
          title: `حذف الزبون "${check.customer.fullName}" نهائياً؟`,
          confirmText: 'حذف الزبون',
          tone: 'danger'
        });
        if (!confirmed) return;

        const result = await scope.run(() => deleteCustomer(customerId));
        if (!result.ok) {
          const [title, body] = describeBlock(result);
          toast.warning(title, body);
          return;
        }
        toast.success('تم حذف الزبون', result.customer.fullName);
      },
      'حدث خطأ أثناء الحذف'
    );
  };

  const totalDebt = roundMoney(Object.values(debts).reduce((sum, debt) => sum + (debt > 0 ? debt : 0), 0));
  const debtorsCount = Object.values(debts).filter((debt) => debt > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-7 h-7 text-primary-600" />
            سجل الزبائن
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">إدارة العملاء ومتابعة الديون</p>
        </div>
        {can('customers.create') && (
          <Button onClick={() => { setEditing(null); setFormData({ fullName: '', phone: '', address: '', notes: '' }); setShowForm(true); }} className="bg-primary-600 hover:bg-primary-700">
            <Plus className="w-4 h-4 ml-2" />
            إضافة زبون جديد
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي العملاء</p>
              <p className="text-xl font-bold">{customers?.length || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">المدينين</p>
              <p className="text-xl font-bold text-amber-600">{debtorsCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي الديون</p>
              <p className="text-lg font-bold text-red-600">{formatCurrency(totalDebt, settings?.currency)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="بحث باسم الزبون أو الهاتف أو العنوان..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers?.map((customer) => {
          const debt = customer.id ? debts[customer.id] || 0 : 0;
          return (
            <Card key={customer.id} className="border-0 shadow-md hover:shadow-xl transition-all duration-300 group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg">
                      {customer.fullName.charAt(0)}
                    </div>
                    <div>
                      <CardTitle className="text-base leading-tight group-hover:text-primary-600 transition-colors">{customer.fullName}</CardTitle>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">عميل منذ {new Date(customer.createdAt).toLocaleDateString('ar-EG')}</p>
                    </div>
                  </div>
                  {debt > 0 ? (
                    <Badge variant="destructive" className="text-[10px]">مدين</Badge>
                  ) : (
                    <Badge variant="success" className="text-[10px]">خالص</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <Phone className="w-4 h-4" />
                      <span dir="ltr">{customer.phone}</span>
                    </div>
                  )}
                  {customer.address && (
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <MapPin className="w-4 h-4" />
                      <span className="truncate">{customer.address}</span>
                    </div>
                  )}
                  {customer.notes && (
                    <p className="text-xs bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg">{customer.notes}</p>
                  )}
                </div>

                <div className={`p-3 rounded-xl border ${debt > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/30'}`}>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">إجمالي الدين الحالي</p>
                  <p className={`text-lg font-bold ${debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(debt, settings?.currency)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link to={`/customers/${customer.id}`} className="col-span-2">
                    <Button variant="default" size="sm" className="w-full bg-primary-600 hover:bg-primary-700">
                      <Eye className="w-3.5 h-3.5 ml-1" />
                      كشف الحساب
                    </Button>
                  </Link>
                  {can('customers.edit') && (
                    <Button variant="outline" size="sm" onClick={() => handleEdit(customer)}>
                      <Edit className="w-3.5 h-3.5 ml-1" />
                      تعديل
                    </Button>
                  )}
                  {can('customers.delete') && (
                    <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => handleDelete(customer)} aria-label={`حذف الزبون ${customer.fullName}`} title="حذف الزبون">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                <div className="flex gap-2">
                  {can('sales.create') && (
                    <Link to={`/invoices/new?customerId=${customer.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        <FileText className="w-3 h-3 ml-1" />
                        فاتورة جديدة
                      </Button>
                    </Link>
                  )}
                  {can('payments.create') && (
                    <Link to={`/payments/new?customerId=${customer.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        <CreditCard className="w-3 h-3 ml-1" />
                        تسديد
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {customers?.length === 0 && (
        <Card className="border-0 shadow-md">
          <CardContent className="text-center py-16">
            <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">لا يوجد عملاء</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">ابدأ بإضافة عملائك</p>
            {can('customers.create') && <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 ml-2" />إضافة زبون</Button>}
          </CardContent>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto overscroll-contain" role="dialog" aria-modal="true" aria-label={editing ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}>
            <CardHeader>
              <CardTitle>{editing ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* noValidate: التحقق العربي في saveCustomer بدل فقاعات المتصفح */}
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">الاسم الكامل *</label>
                  <Input placeholder="الاسم الثلاثي أو الرباعي" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} aria-required="true" autoFocus />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">رقم الهاتف</label>
                  <Input placeholder="مثال: 07701234567" inputMode="tel" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} dir="ltr" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">العنوان</label>
                  <Input placeholder="المحافظة - المنطقة - القرية" value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                  <textarea value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="flex min-h-[80px] w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" placeholder="ملاحظات إضافية..." />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" className="flex-1 bg-primary-600 hover:bg-primary-700">{editing ? 'حفظ التعديلات' : 'إضافة الزبون'}</Button>
                  <Button type="button" variant="outline" onClick={closeForm}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
