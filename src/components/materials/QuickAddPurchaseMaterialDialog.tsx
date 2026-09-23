import { useState } from 'react';
import { Loader2, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericTextInput } from '@/components/ui/number-input';
import { createMaterial, findMaterialByName } from '@/lib/materials';
import { useModalCloser } from '@/hooks/useModalCloser';
import { reportError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { toFiniteNumber } from '@/lib/utils';
import type { Material } from '@/types';

interface QuickAddPurchaseMaterialDialogProps {
  open: boolean;
  initialName?: string;
  currency?: string;
  defaultMinQuantity?: number;
  onClose: () => void;
  onCreated: (material: Material) => void;
}

const UNITS = ['قطعة', 'كيس', 'علبة', 'لتر', 'كغم', 'متر', 'عبوة'];

/** إنشاء مادة من داخل وصل الشراء برصيد ابتدائي صفر؛ الوصل نفسه يضيف الكمية. */
export function QuickAddPurchaseMaterialDialog(props: QuickAddPurchaseMaterialDialogProps) {
  // الرجوع و Escape يُغلقان النافذة وحدها (المستمع مركزي في modalStack)
  useModalCloser(props.open, props.onClose, { label: 'إضافة مادة للشراء' });

  if (!props.open) return null;
  // تركيب جديد مع كل فتح: تُهيَّأ الحقول من الخصائص بلا تأثير إعادة ضبط
  return <QuickAddPurchaseMaterialForm {...props} />;
}

function QuickAddPurchaseMaterialForm({
  initialName = '',
  currency = 'د.ع',
  defaultMinQuantity = 5,
  onClose,
  onCreated
}: Omit<QuickAddPurchaseMaterialDialogProps, 'open'>) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.warning('اسم المادة مطلوب');
      return;
    }

    setIsSaving(true);
    try {
      const existing = await findMaterialByName(trimmedName);
      if (existing) {
        toast.info('المادة مسجّلة مسبقاً', `تم اختيار "${existing.name}"`);
        onCreated(existing);
        onClose();
        return;
      }

      const sale = toFiniteNumber(salePrice, NaN);
      const purchase = toFiniteNumber(purchasePrice, NaN);
      const result = await createMaterial({
        name: trimmedName,
        quantity: 0,
        salePrice: Number.isFinite(sale) ? sale : 0,
        purchasePrice: Number.isFinite(purchase) ? purchase : undefined,
        category,
        unit,
        minQuantity: Math.max(0, toFiniteNumber(defaultMinQuantity, 5))
      });
      if (!result.ok) {
        toast.warning('تعذّر إضافة المادة', result.error);
        return;
      }
      toast.success('تم تسجيل المادة', 'ستُضاف كمية الشراء إليها عند حفظ الوصل');
      onCreated(result.material);
      onClose();
    } catch (error) {
      reportError('QuickAddPurchaseMaterial.save', error, 'حدث خطأ أثناء تسجيل المادة');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="تسجيل مادة جديدة">
      <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto overscroll-contain animate-slide-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="w-5 h-5 text-primary-600" />
            تسجيل مادة جديدة أثناء الشراء
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">لا تُضاف كمية الآن؛ كمية الوصل ستُرحّل للمخزن عند الحفظ.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">اسم المادة *</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus required placeholder="مثلاً: سماد يوريا" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">الفئة</label>
                <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="أسمدة، مبيدات..." />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">الوحدة</label>
                <select value={unit} onChange={(event) => setUnit(event.target.value)} className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                  {UNITS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">سعر الشراء ({currency}) *</label>
                <NumericTextInput value={purchasePrice} onValueChange={setPurchasePrice} placeholder="0" required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">سعر البيع المقترح</label>
                <NumericTextInput value={salePrice} onValueChange={setSalePrice} placeholder="اختياري" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isSaving} className="flex-1 bg-primary-600 hover:bg-primary-700">
                {isSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                {isSaving ? 'جاري الحفظ…' : 'تسجيل واستخدام المادة'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>إلغاء</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
