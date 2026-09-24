import { useState } from 'react';
import { Package, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericTextInput } from '@/components/ui/number-input';
import { createMaterial, findMaterialByName } from '@/lib/materials';
import { useModalCloser } from '@/hooks/useModalCloser';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/errors';
import { toFiniteNumber } from '@/lib/utils';
import type { Material } from '@/types';

/**
 * إضافة مادة جديدة من داخل فاتورة البيع مباشرة.
 *
 * المشكلة السابقة: إنشاء فاتورة كان يتطلب مواد مُدخلة مسبقاً حصراً، فإذا
 * جاءت بضاعة جديدة أثناء البيع اضطر المستخدم لترك الفاتورة والذهاب
 * للمخزن ثم العودة. هذه النافذة تُسجّل المادة في المخزن فوراً وتُضيفها
 * للفاتورة في خطوة واحدة، بنفس قواعد التحقق في صفحة المخزن.
 */

interface QuickAddMaterialDialogProps {
  open: boolean;
  /** اسم مبدئي (نص البحث الذي لم يُعثر عليه) */
  initialName?: string;
  currency?: string;
  defaultMinQuantity?: number;
  onClose: () => void;
  onCreated: (material: Material) => void;
}

const UNITS = ['قطعة', 'كيس', 'علبة', 'لتر', 'كغم', 'متر', 'عبوة'];

export function QuickAddMaterialDialog(props: QuickAddMaterialDialogProps) {
  // الرجوع و Escape يُغلقان النافذة وحدها (المستمع مركزي في modalStack)
  useModalCloser(props.open, props.onClose, { label: 'إضافة مادة سريعة' });

  if (!props.open) return null;
  // النموذج يُركَّب من جديد مع كل فتح، فتُهيَّأ الحقول من الخصائص مباشرة
  // بدل إعادة ضبطها بـ setState داخل تأثير (النمط الذي تمنعه قواعد React).
  return <QuickAddMaterialForm {...props} />;
}

function QuickAddMaterialForm({
  initialName = '',
  currency = 'د.ع',
  defaultMinQuantity = 5,
  onClose,
  onCreated
}: Omit<QuickAddMaterialDialogProps, 'open'>) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [quantity, setQuantity] = useState('1');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('5');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.warning('اسم المادة مطلوب');
      return;
    }

    setIsSaving(true);
    try {
      // منع التكرار: إذا وُجدت المادة نستخدمها مباشرة بدل إنشاء نسخة ثانية
      const existing = await findMaterialByName(trimmedName);
      if (existing) {
        toast.info('المادة مسجّلة مسبقاً', `تم استخدام "${existing.name}" من المخزن`);
        onCreated(existing);
        onClose();
        return;
      }

      const result = await createMaterial({
        name: trimmedName,
        category,
        unit,
        quantity: toFiniteNumber(quantity, 0),
        salePrice: toFiniteNumber(salePrice, NaN),
        purchasePrice: purchasePrice.trim() ? toFiniteNumber(purchasePrice, NaN) : undefined,
        minQuantity: toFiniteNumber(minQuantity, defaultMinQuantity)
      });

      if (!result.ok) {
        toast.warning('تعذّر إضافة المادة', result.error);
        return;
      }

      toast.success('تمت إضافة المادة للمخزن', result.material.name);
      onCreated(result.material);
      onClose();
    } catch (error) {
      reportError('QuickAddMaterial.save', error, 'حدث خطأ أثناء إضافة المادة');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="إضافة مادة جديدة">
      <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto overscroll-contain animate-slide-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="w-5 h-5 text-primary-600" />
            إضافة مادة جديدة للمخزن
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">ستُحفظ في سجل المواد وتُضاف للفاتورة الحالية فوراً</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">اسم المادة *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسم المادة" required autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">الفئة</label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="اكتب الفئة" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">الوحدة</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">الكمية *</label>
                <NumericTextInput value={quantity} onValueChange={setQuantity} required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">سعر البيع *</label>
                <NumericTextInput value={salePrice} onValueChange={setSalePrice} required placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">سعر الشراء</label>
                <NumericTextInput value={purchasePrice} onValueChange={setPurchasePrice} placeholder="اختياري" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">الحد الأدنى للتنبيه</label>
              <NumericTextInput value={minQuantity} onValueChange={setMinQuantity} className="max-w-[160px]" />
              <p className="text-[11px] text-gray-500 mt-1">العملة: {currency} — يمكن تعديل كل التفاصيل لاحقاً من صفحة المخزن</p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isSaving} className="flex-1 bg-primary-600 hover:bg-primary-700">
                {isSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                {isSaving ? 'جاري الحفظ…' : 'حفظ وإضافة للفاتورة'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                إلغاء
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
