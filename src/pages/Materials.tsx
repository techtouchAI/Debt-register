import { useState, useEffect } from 'react';
import { Package, Plus, Search, Edit, Trash2, AlertTriangle, Filter, TrendingDown, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, getSettings, logActivity } from '@/lib/db';
import { createMaterial, updateMaterial } from '@/lib/materials';
import { useLiveQuery } from 'dexie-react-hooks';
import { useModalCloser } from '@/hooks/useModalCloser';
import { formatCurrency, getStockStatus, getStockStatusColor, getStockStatusText, roundMoney, toFiniteNumber } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { Material } from '@/types';

export function Materials() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'normal'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [formData, setFormData] = useState<Partial<Material>>({
    name: '',
    quantity: 0,
    salePrice: 0,
    purchasePrice: 0,
    minQuantity: 5,
    category: '',
    unit: 'قطعة',
    description: ''
  });

  const settings = useLiveQuery(() => getSettings(), []);

  const materials = useLiveQuery(async () => {
    const all = await db.materials.toArray();
    const query = search.trim().toLowerCase();

    let filtered = all;
    if (query) {
      filtered = filtered.filter(
        (material) =>
          material.name.toLowerCase().includes(query) ||
          (material.category ?? '').toLowerCase().includes(query) ||
          (material.barcode ?? '').includes(query)
      );
    }

    if (filter !== 'all') {
      filtered = filtered.filter((material) => getStockStatus(material.quantity, material.minQuantity) === filter);
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [search, filter]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'new') {
      setShowForm(true);
    }
  }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  useModalCloser(showForm, closeForm);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // الحفظ عبر الوحدة الموحّدة (نفس قواعد الإضافة السريعة داخل الفاتورة)
    const input = {
      name: formData.name ?? '',
      quantity: toFiniteNumber(formData.quantity),
      salePrice: toFiniteNumber(formData.salePrice, NaN),
      purchasePrice: formData.purchasePrice ?? undefined,
      minQuantity: toFiniteNumber(formData.minQuantity, toFiniteNumber(settings?.lowStockThreshold, 5)),
      category: formData.category ?? '',
      unit: formData.unit ?? 'قطعة',
      barcode: formData.barcode ?? '',
      description: formData.description ?? ''
    };

    try {
      if (editing?.id) {
        const result = await updateMaterial(editing.id, input);
        if (!result.ok) {
          toast.warning('تعذّر الحفظ', result.error);
          return;
        }
        toast.success('تم تحديث المادة', result.material.name);
      } else {
        const result = await createMaterial(input);
        if (!result.ok) {
          toast.warning('تعذّر الحفظ', result.error);
          return;
        }
        toast.success('تمت إضافة المادة', result.material.name);
      }

      closeForm();
      setFormData({ name: '', quantity: 0, salePrice: 0, purchasePrice: 0, minQuantity: 5, category: '', unit: 'قطعة', description: '' });
    } catch (error) {
      reportError('Materials.save', error, 'حدث خطأ أثناء الحفظ');
    }
  };

  const handleEdit = (material: Material) => {
    setEditing(material);
    setFormData(material);
    setShowForm(true);
  };

  const handleDelete = async (material: Material) => {
    if (!material.id) return;
    if (!confirm(`هل أنت متأكد من حذف المادة "${material.name}"؟\nسيتم حذفها نهائياً ولا يمكن التراجع.`)) return;

    try {
      const used = await db.invoiceItems.where('materialId').equals(material.id).count();
      if (used > 0) {
        toast.warning('لا يمكن الحذف', `المادة مستخدمة في ${used} فاتورة. يمكن تعديل الكمية إلى صفر بدلاً من الحذف.`);
        return;
      }

      await db.materials.delete(material.id);
      await logActivity('حذف مادة', `تم حذف المادة: ${material.name}`, 'material', material.id);
      toast.success('تم حذف المادة', material.name);
    } catch (error) {
      reportError('Materials.delete', error, 'حدث خطأ أثناء الحذف');
    }
  };

  const totalValue = roundMoney((materials ?? []).reduce((sum, material) => sum + roundMoney(toFiniteNumber(material.quantity) * toFiniteNumber(material.salePrice)), 0));
  const totalProfitPotential = roundMoney(
    (materials ?? []).reduce(
      (sum, material) =>
        sum + (material.purchasePrice ? roundMoney((toFiniteNumber(material.salePrice) - toFiniteNumber(material.purchasePrice)) * toFiniteNumber(material.quantity)) : 0),
      0
    )
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="w-7 h-7 text-primary-600" />
            إدارة المخزن
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">إدارة المواد الزراعية والأسمدة والمبيدات</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormData({ name: '', quantity: 0, salePrice: 0, purchasePrice: 0, minQuantity: 5, category: '', unit: 'قطعة', description: '' }); setShowForm(true); }} className="bg-primary-600 hover:bg-primary-700">
          <Plus className="w-4 h-4 ml-2" />
          إضافة مادة جديدة
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي المواد</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{materials?.length || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">قيمة المخزون</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(totalValue, settings?.currency)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">أرباح محتملة</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(totalProfitPotential, settings?.currency)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-purple-600 rotate-180" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">منخفضة المخزون</p>
                <p className="text-xl font-bold text-amber-600">{materials?.filter(m => getStockStatus(m.quantity, m.minQuantity) !== 'normal').length || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="بحث باسم المادة أو الفئة أو الباركود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="flex gap-2">
              <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>الكل</Button>
              <Button variant={filter === 'low' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('low')} className={filter === 'low' ? 'bg-amber-600 hover:bg-amber-700' : ''}>
                <Filter className="w-3 h-3 ml-1" />
                منخفض
              </Button>
              <Button variant={filter === 'out' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('out')} className={filter === 'out' ? 'bg-red-600 hover:bg-red-700' : ''}>نافد</Button>
              <Button variant={filter === 'normal' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('normal')} className={filter === 'normal' ? 'bg-green-600 hover:bg-green-700' : ''}>متوفر</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Materials Table — سطر واحد لكل مادة مع كل معلوماتها */}
      {(materials?.length ?? 0) > 0 && (
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 text-[12px] text-gray-600 dark:text-gray-300">
                  <th className="p-3 text-center font-bold w-10">#</th>
                  <th className="p-3 text-right font-bold">المادة</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">الفئة</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap">الكمية</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap">سعر الشراء</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap">سعر البيع</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap">الربح/وحدة</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap">الحالة</th>
                  <th className="p-3 text-center font-bold whitespace-nowrap w-28">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {materials?.map((material, index) => {
                  const status = getStockStatus(material.quantity, material.minQuantity);
                  return (
                    <tr
                      key={material.id}
                      className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="p-3 text-center text-gray-400">{index + 1}</td>
                      <td className="p-3">
                        <p className="font-bold text-gray-900 dark:text-white leading-tight">{material.name}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          {material.unit || 'قطعة'}
                          {material.barcode ? ` • باركود: ${material.barcode}` : ''}
                          {material.description ? ` • ${material.description}` : ''}
                        </p>
                      </td>
                      <td className="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{material.category || 'عام'}</td>
                      <td className="p-3 text-center font-bold whitespace-nowrap">{material.quantity}</td>
                      <td className="p-3 text-center whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {material.purchasePrice ? formatCurrency(material.purchasePrice, settings?.currency) : '—'}
                      </td>
                      <td className="p-3 text-center font-bold whitespace-nowrap text-green-600">
                        {formatCurrency(material.salePrice, settings?.currency)}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap text-purple-600">
                        {material.purchasePrice ? formatCurrency(material.salePrice - material.purchasePrice, settings?.currency) : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <Badge className={`${getStockStatusColor(status)} border text-[10px] whitespace-nowrap`}>
                          {getStockStatusText(status)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleEdit(material)}>
                            <Edit className="w-3.5 h-3.5 ml-1" />
                            تعديل
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            aria-label={`حذف ${material.name}`}
                            onClick={() => handleDelete(material)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {materials?.length === 0 && (
        <Card className="border-0 shadow-md">
          <CardContent className="text-center py-16">
            <Package className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">لا توجد مواد</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">ابدأ بإضافة موادك الزراعية للمخزن</p>
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 ml-2" />إضافة مادة</Button>
          </CardContent>
        </Card>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>{editing ? 'تعديل مادة' : 'إضافة مادة جديدة'}</CardTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400">جميع الحقول المميزة بـ * مطلوبة</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium mb-1 block">اسم المادة *</label>
                    <Input
                      placeholder="مثلاً: مبيد عناكب، سماد يوريا، بذور طماطم..."
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">الفئة</label>
                    <Input
                      placeholder="مبيدات، أسمدة، بذور..."
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">الوحدة</label>
                    <select
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    >
                      <option value="قطعة">قطعة</option>
                      <option value="كيس">كيس</option>
                      <option value="علبة">علبة</option>
                      <option value="لتر">لتر</option>
                      <option value="كغم">كغم</option>
                      <option value="متر">متر</option>
                      <option value="عبوة">عبوة</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">الكمية الحالية *</label>
                    <Input type="number" min="0" step="0.01" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })} required />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">الحد الأدنى للتنبيه</label>
                    <Input type="number" min="0" value={formData.minQuantity} onChange={(e) => setFormData({ ...formData, minQuantity: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">سعر البيع * ({settings?.currency})</label>
                    <Input type="number" min="0" step="0.01" value={formData.salePrice} onChange={(e) => setFormData({ ...formData, salePrice: Number(e.target.value) })} required />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">سعر الشراء (اختياري - لحساب الأرباح)</label>
                    <Input type="number" min="0" step="0.01" value={formData.purchasePrice || ''} onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value ? Number(e.target.value) : undefined })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">الباركود (اختياري)</label>
                    <Input placeholder="رمز المادة" value={formData.barcode || ''} onChange={(e) => setFormData({ ...formData, barcode: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium mb-1 block">الوصف</label>
                    <textarea
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="flex min-h-[80px] w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                      placeholder="وصف المادة وطريقة الاستخدام..."
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button type="submit" className="flex-1 bg-primary-600 hover:bg-primary-700">{editing ? 'حفظ التعديلات' : 'إضافة المادة'}</Button>
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
