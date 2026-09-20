import { useState, useEffect } from 'react';
import { Package, Plus, Search, Edit, Trash2, AlertTriangle, Filter, TrendingDown, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { db, logActivity, createNotification, checkLowStock, getSettings } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = (formData.name ?? '').trim();
    const salePrice = toFiniteNumber(formData.salePrice, NaN);
    if (!name || !Number.isFinite(salePrice) || salePrice < 0) {
      toast.warning('حقول ناقصة', 'اسم المادة وسعر البيع مطلوبان');
      return;
    }

    const now = new Date().toISOString();
    const defaultThreshold = toFiniteNumber(settings?.lowStockThreshold, 5);
    const materialData: Material = {
      name,
      quantity: Math.max(0, toFiniteNumber(formData.quantity)),
      salePrice,
      purchasePrice:
        formData.purchasePrice === undefined || formData.purchasePrice === null
          ? undefined
          : Math.max(0, toFiniteNumber(formData.purchasePrice)),
      minQuantity: Math.max(0, toFiniteNumber(formData.minQuantity, defaultThreshold)),
      category: (formData.category ?? '').trim() || 'عام',
      unit: formData.unit || 'قطعة',
      description: (formData.description ?? '').trim() || undefined,
      barcode: (formData.barcode ?? '').trim() || undefined,
      createdAt: editing?.createdAt || now,
      updatedAt: now
    };

    try {
      if (editing?.id) {
        await db.materials.update(editing.id, materialData);
        await logActivity('تعديل مادة', `تم تعديل المادة: ${materialData.name}`, 'material', editing.id);
        toast.success('تم تحديث المادة', materialData.name);
      } else {
        const id = (await db.materials.add(materialData)) as number;
        await logActivity('إضافة مادة', `تمت إضافة مادة جديدة: ${materialData.name}`, 'material', id);
        if (materialData.quantity <= materialData.minQuantity) {
          await createNotification(
            'تنبيه مخزون',
            `المادة "${materialData.name}" كميتها منخفضة: ${materialData.quantity}`,
            { type: 'warning', relatedId: id, relatedType: 'material', code: 'low-stock' }
          );
        }
        toast.success('تمت إضافة المادة', materialData.name);
      }

      setShowForm(false);
      setEditing(null);
      setFormData({ name: '', quantity: 0, salePrice: 0, purchasePrice: 0, minQuantity: 5, category: '', unit: 'قطعة', description: '' });
      await checkLowStock();
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

      {/* Materials Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {materials?.map((material) => {
          const status = getStockStatus(material.quantity, material.minQuantity);
          return (
            <Card key={material.id} className="border-0 shadow-md hover:shadow-xl transition-all duration-300 group overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base leading-tight group-hover:text-primary-600 transition-colors">{material.name}</CardTitle>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{material.category || 'عام'} • {material.unit}</p>
                  </div>
                  <Badge className={`${getStockStatusColor(status)} border text-[10px]`}>
                    {getStockStatusText(status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">الكمية</p>
                    <p className="font-bold text-gray-900 dark:text-white">{material.quantity} {material.unit}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">سعر البيع</p>
                    <p className="font-bold text-green-600">{formatCurrency(material.salePrice, settings?.currency)}</p>
                  </div>
                  {material.purchasePrice && (
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">سعر الشراء</p>
                      <p className="font-medium text-gray-700 dark:text-gray-300">{formatCurrency(material.purchasePrice, settings?.currency)}</p>
                    </div>
                  )}
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">الربح/قطعة</p>
                    <p className="font-medium text-purple-600">
                      {material.purchasePrice ? formatCurrency(material.salePrice - material.purchasePrice, settings?.currency) : '-'}
                    </p>
                  </div>
                </div>

                {material.description && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 p-2 rounded-lg line-clamp-2">{material.description}</p>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEdit(material)}>
                    <Edit className="w-3.5 h-3.5 ml-1" />
                    تعديل
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => handleDelete(material)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
