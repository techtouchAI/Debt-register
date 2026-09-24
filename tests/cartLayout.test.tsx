import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { db } from '@/lib/db';
import { seedOfficeProfile } from './helpers';

/**
 * عقد تخطيط سلة المواد في نموذجي الفاتورة ووصل الشراء.
 *
 * العلّة التي يحرسها الاختبار: الأعمدة الرقمية في جدول من 12 عموداً كانت
 * تضيق على شاشات الهاتف حتى يظهر رقم واحد من السعر أو الكمية (قصّ داخل
 * الحقل). الحل ليس تصغير الخط بل تخطيط متجاوب: عمودان على الجوال (نصف
 * العرض للحقل) و12 عموداً على `sm` فأعلى، مع عنوان ظاهر لكل حقل على الجوال
 * ورأس جدول مخفي، ودون أي عرض ثابت يضغط الحقل.
 *
 * jsdom لا يحسب أبعاداً حقيقية، فيُثبَّت العقد على الفئات المسؤولة عن
 * التخطيط كما يراها المتصفح في كل مقاس.
 */

async function seedMaterial(name = 'سماد يوريا') {
  const now = new Date().toISOString();
  return (await db.materials.add({
    name,
    quantity: 100,
    salePrice: 1000,
    minQuantity: 1,
    unit: 'كيس',
    category: 'أسمدة',
    createdAt: now,
    updatedAt: now
  })) as number;
}

async function bootForm(hash: string, materialName: string, searchPlaceholder: RegExp) {
  await seedOfficeProfile();
  await seedMaterial(materialName);
  window.location.hash = hash;
  render(<App />);
  const search = await screen.findByPlaceholderText(searchPlaceholder, undefined, { timeout: 5000 });
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: materialName } });
  fireEvent.click(await screen.findByText(materialName, undefined, { timeout: 5000 }));
}

/** السطر نفسه: الشبكة التي تحوي حقول المادة (عمودان على الجوال). */
function lineOf(input: HTMLElement): HTMLElement {
  const line = input.closest('div.grid') as HTMLElement | null;
  if (!line) throw new Error('لم يُعثر على سطر السلة');
  return line;
}

/** لا عرض ثابت على الحقول الرقمية: العرض يأتي من الشبكة (`w-full`). */
function expectFluidWidth(input: HTMLElement) {
  const classes = input.className;
  expect(classes).toContain('w-full');
  expect(classes).not.toMatch(/(^|\s)w-(1[0-9]|[0-9]|2[0-9]|3[0-9])(\s|$)/);
}

beforeEach(() => {
  cleanup();
  window.location.hash = '#/';
});

describe('سلة المواد — تخطيط متجاوب لا يقصّ الأرقام', () => {
  it('في الفاتورة: الحقول تأخذ نصف العرض على الجوال وتبقى 12 عموداً على الأوسع', async () => {
    await bootForm('#/invoices/new', 'سماد يوريا', /ابحث باسم المادة/);

    const quantity = (await screen.findByLabelText('كمية سماد يوريا', undefined, { timeout: 5000 })) as HTMLInputElement;
    const price = screen.getByLabelText('سعر سماد يوريا') as HTMLInputElement;

    // السطر: شبكة بعمودين على الجوال، و12 عموداً من `sm` فأعلى
    const line = lineOf(quantity);
    expect(line.className).toContain('grid-cols-2');
    expect(line.className).toContain('sm:grid-cols-12');
    expect(line.contains(price)).toBe(true);

    // العرض سائل لا مضغوط
    expectFluidWidth(quantity);
    expectFluidWidth(price);

    // عناوين الحقول ظاهرة على الجوال فقط، ومخفية عن القارئ الصوتي لأن
    // الاسم الميسَّر للحقل يحمل اسم المادة كاملاً
    const quantityCell = quantity.parentElement as HTMLElement;
    const hint = quantityCell.querySelector('span') as HTMLElement;
    expect(hint.textContent).toBe('الكمية');
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    expect(hint.className).toContain('sm:hidden');
    expect(quantityCell.className).toContain('min-w-0');

    const priceHint = (price.parentElement as HTMLElement).querySelector('span') as HTMLElement;
    expect(priceHint.textContent).toBe('السعر المفرد');

    // رأس الجدول مخفي على الجوال ومظهر على الأوسع
    const header = screen.getByText('السعر المفرد', { selector: 'div' });
    expect(header.parentElement?.className).toContain('hidden');
    expect(header.parentElement?.className).toContain('sm:grid');
  });

  it('في وصل الشراء: الحقول تأخذ نصف العرض على الجوال أيضاً', async () => {
    await bootForm('#/purchases/new', 'سماد يوريا', /ابحث عن مادة مسجلة/);

    const quantity = (await screen.findByLabelText('كمية سماد يوريا', undefined, { timeout: 5000 })) as HTMLInputElement;
    const price = screen.getByLabelText('سعر شراء سماد يوريا') as HTMLInputElement;

    const line = lineOf(quantity);
    expect(line.className).toContain('grid-cols-2');
    expect(line.className).toContain('sm:grid-cols-12');
    expect(line.contains(price)).toBe(true);

    expectFluidWidth(quantity);
    expectFluidWidth(price);

    const priceCell = price.parentElement as HTMLElement;
    const hint = priceCell.querySelector('span') as HTMLElement;
    expect(hint.textContent).toBe('سعر الشراء');
    expect(hint.className).toContain('sm:hidden');
  });

  it('يُكتب الرقم كاملاً داخل الحقل بلا حد أقصى للطول', async () => {
    await bootForm('#/invoices/new', 'سماد يوريا', /ابحث باسم المادة/);

    const price = (await screen.findByLabelText('سعر سماد يوريا', undefined, { timeout: 5000 })) as HTMLInputElement;
    fireEvent.change(price, { target: { value: '250000' } });
    expect(price.value).toBe('250000');

    const quantity = screen.getByLabelText('كمية سماد يوريا') as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: '12' } });
    expect(quantity.value).toBe('12');
    await waitFor(() => expect(screen.queryAllByRole('alert')).toEqual([]));
  });
});
