import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Search, Edit, Trash2, Phone, MapPin, DollarSign, FileText, CreditCard, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, logActivity } from '@/lib/db';
import { getCustomerBalances } from '@/lib/debts';
import { useLiveQuery } from 'dexie-react-hooks';
import { useModalCloser } from '@/hooks/useModalCloser';
import { formatCurrency, roundMoney } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { Customer } from '@/types';

export function Customers() {
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
  const debts: Record<number, number> = {};
  if (balances) {
    for (const [customerId, balance] of balances) debts[customerId] = balance.debt;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName?.trim()) {
      toast.warning('اسم الزبون مطلوب', 'أدخل الاسم الكامل قبل الحفظ');
      return;
    }

    const now = new Date().toISOString();
    const customerData: Customer = {
      fullName: formData.fullName.trim(),
      phone: formData.phone?.trim(),
      address: formData.address?.trim(),
      notes: formData.notes?.trim(),
      createdAt: editing?.createdAt || now,
      updatedAt: now
    };

    try {
      if (editing?.id) {
        await db.customers.update(editing.id, customerData);
        await logActivity('تعديل زبون', `تم تعديل بيانات الزبون: ${customerData.fullName}`, 'customer', editing.id).catch((error) =>
          console.warn('تعذّر تسجيل نشاط الزبون:', error)
        );
        toast.success('تم تحديث بيانات الزبون', customerData.fullName);
      } else {
        const id = (await db.customers.add(customerData)) as number;
        await logActivity('إضافة زبون', `تمت إضافة زبون جديد: ${customerData.fullName}`, 'customer', id).catch((error) =>
          console.warn('تعذّر تسجيل نشاط الزبون:', error)
        );
        toast.success('تمت إضافة الزبون', customerData.fullName);
      }
      closeForm();
      setFormData({ fullName: '', phone: '', address: '', notes: '' });
    } catch (error) {
      reportError('Customers.save', error, 'حدث خطأ أثناء الحفظ');
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditing(customer);
    setFormData(customer);
    setShowForm(true);
  };

  const handleDelete = async (customer: Customer) => {
    if (!customer.id) return;
    const debt = debts[customer.id] || 0;
    if (debt > 0) {
      toast.warning('لا يمكن الحذف', `الزبون "${customer.fullName}" مدين بمبلغ ${formatCurrency(debt, settings?.currency)}. يجب تسديد الدين أولاً.`);
      return;
    }

    try {
      const invoicesCount = await db.invoices.where('customerId').equals(customer.id).count();
      const paymentsCount = await db.payments.where('customerId').equals(customer.id).count();
      if (invoicesCount > 0 || paymentsCount > 0) {
        toast.warning(
          'لا يمكن حذف الزبون',
          `لديه ${invoicesCount} فاتورة و${paymentsCount} تسديد. إبقاء السجل يحافظ على سلامة كشف الحساب.`
        );
        return;
      }
      if (!confirm(`هل أنت متأكد من حذف الزبون "${customer.fullName}" نهائياً؟`)) return;

      await db.customers.delete(customer.id);
      await logActivity('حذف زبون', `تم حذف الزبون: ${customer.fullName}`, 'customer', customer.id).catch((error) =>
        console.warn('تعذّر تسجيل نشاط الزبون:', error)
      );
      toast.success('تم حذف الزبون', customer.fullName);
    } catch (error) {
      reportError('Customers.delete', error, 'حدث خطأ أثناء الحذف');
    }
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
        <Button onClick={() => { setEditing(null); setFormData({ fullName: '', phone: '', address: '', notes: '' }); setShowForm(true); }} className="bg-primary-600 hover:bg-primary-700">
          <Plus className="w-4 h-4 ml-2" />
          إضافة زبون جديد
        </Button>
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
                  <Button variant="outline" size="sm" onClick={() => handleEdit(customer)}>
                    <Edit className="w-3.5 h-3.5 ml-1" />
                    تعديل
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => handleDelete(customer)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Link to={`/invoices/new?customerId=${customer.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      <FileText className="w-3 h-3 ml-1" />
                      فاتورة جديدة
                    </Button>
                  </Link>
                  <Link to={`/payments/new?customerId=${customer.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      <CreditCard className="w-3 h-3 ml-1" />
                      تسديد
                    </Button>
                  </Link>
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
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 ml-2" />إضافة زبون</Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>{editing ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">الاسم الكامل *</label>
                  <Input placeholder="الاسم الثلاثي أو الرباعي" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">رقم الهاتف</label>
                  <Input placeholder="07xxxxxxxx" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} dir="ltr" />
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
