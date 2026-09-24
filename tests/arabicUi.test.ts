import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * حارس دائم لقاعدة "لا كلمة إنجليزية داخل التطبيق".
 *
 * يقرأ كل ملفات الواجهة بمحلّل TypeScript نفسه ويفحص كل نص يصل إلى عين
 * المستخدم: نصوص JSX، والخصائص الظاهرة (placeholder/title/aria-label/alt)،
 * ورسائل التنبيه والتأكيد والأخطاء والإشعارات وسجل النشاط، وعناوين عناصر
 * الواجهة المعرّفة في المصفوفات (title/desc/label...). أي حرف لاتيني فيها
 * يُفشل الاختبار مع اسم الملف والسطر — فلا تعود "system" أو "PDF" أو "KB".
 */
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const LATIN = /[A-Za-z]/;

const UI_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const UI_PROPERTIES = new Set(['title', 'desc', 'label', 'message', 'change', 'confirmText', 'cancelText', 'shareTitle', 'details']);
/** دوال رسائلها تظهر للمستخدم: اسم الدالة ← مواضع الوسائط الظاهرة */
const UI_CALLS: Record<string, number[] | 'all'> = {
  'toast.success': 'all',
  'toast.error': 'all',
  'toast.info': 'all',
  'toast.warning': 'all',
  reportError: [2],
  createNotification: [0, 1],
  sendSystemNotification: [0, 1],
  logActivity: [0, 1]
};
/**
 * حقول قيمها رموز داخلية إنجليزية (info/system/cash/admin...): عرضها مباشرة
 * في الواجهة هو بالضبط خطأ "system / info" في الإشعارات — يجب أن تمرّ عبر
 * دوال التسمية العربية في lib/labels.ts.
 */
const ENUM_FIELDS = new Set(['type', 'relatedType', 'method', 'role', 'status', 'source', 'paymentMethod', 'kind']);
/** رموز داخلية لا تُعرض (تُحوَّل قبل العرض) */
const INTERNAL_ERROR_CODES = /^(?:[A-Z_]+|shutdown|unmounted|cancelled)$/;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** كل الأجزاء النصية الثابتة لتعبير (سلسلة، قالب، شرط، ربط بـ +). */
function literalParts(node: ts.Node | undefined): Array<{ text: string; node: ts.Node }> {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: node.text, node }];
  if (ts.isTemplateExpression(node)) {
    return [
      { text: node.head.text, node: node.head },
      ...node.templateSpans.flatMap((span) => [...literalParts(span.expression), { text: span.literal.text, node: span.literal }])
    ];
  }
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return literalParts(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalParts(node.whenTrue), ...literalParts(node.whenFalse)];
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [...literalParts(node.left), ...literalParts(node.right)];
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => literalParts(element));
  return [];
}

/** فحص ملف واحد (نصه) — يُعيد قائمة المشكلات "الملف:السطر [السياق] النص". */
function scanSource(file: string, text: string): string[] {
  const problems: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const where = (node: ts.Node) => `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const report = (raw: string, node: ts.Node, context: string) => {
    // كيانات HTML في نصوص JSX (&quot; &nbsp;) تُعرض رموزاً لا كلمات
    const value = raw.replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, '');
    if (!LATIN.test(value)) return;
    problems.push(`${where(node)} [${context}] ${JSON.stringify(value.trim()).slice(0, 120)}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.trim()) report(node.text, node, 'نص ظاهر');

    // {notification.type} كابن مباشر في JSX = قيمة داخلية إنجليزية على الشاشة
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ENUM_FIELDS.has(node.expression.name.text)
    ) {
      problems.push(`${where(node)} [قيمة داخلية معروضة كما هي] ${node.expression.getText()}`);
    }

    if (ts.isJsxAttribute(node) && UI_ATTRIBUTES.has(node.name.getText()) && node.initializer) {
      for (const part of literalParts(node.initializer)) report(part.text, part.node, node.name.getText());
    }

    if (ts.isPropertyAssignment(node) && UI_PROPERTIES.has(node.name.getText())) {
      for (const part of literalParts(node.initializer)) report(part.text, part.node, `خاصية ${node.name.getText()}`);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const positions = UI_CALLS[callee];
      if (positions) {
        node.arguments.forEach((argument, index) => {
          if (positions === 'all' || positions.includes(index)) {
            for (const part of literalParts(argument)) report(part.text, part.node, callee);
          }
        });
      }
    }

    if (ts.isNewExpression(node) && /(^|\.)Error$/.test(node.expression.getText()) && node.arguments?.[0]) {
      for (const part of literalParts(node.arguments[0])) {
        if (!INTERNAL_ERROR_CODES.test(part.text)) report(part.text, part.node, 'رسالة خطأ');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

function findEnglishInUi(): string[] {
  return listSourceFiles(SRC).flatMap((file) => scanSource(file, readFileSync(file, 'utf8')));
}

describe('الواجهة عربية بالكامل', () => {
  it('لا توجد كلمة إنجليزية في أي نص يراه المستخدم', () => {
    const problems = findEnglishInUi();
    expect(problems, `نصوص إنجليزية ظاهرة للمستخدم:\n${problems.join('\n')}`).toEqual([]);
  });

  it('الحارس نفسه يكتشف النص الإنجليزي والقيم الداخلية (حماية من فحص فارغ)', () => {
    expect(listSourceFiles(SRC).length).toBeGreaterThan(50);
    const sample = [
      'export const View = () => (',
      '  <div>',
      '    <p title="Save">حفظ PDF</p>',
      '    <Badge>{notification.type}</Badge>',
      '    <span>{notificationTypeLabel(notification.type)}</span>',
      '    <input placeholder="07xxxxxxxx" />',
      '  </div>',
      ');',
      "toast.success('تم', 'KB');",
      "throw new Error('Failed to save');"
    ].join('\n');
    const problems = scanSource(join(SRC, 'sample.tsx'), sample).map((problem) => problem.replace(/^[^[]+/, ''));
    expect(problems).toEqual([
      '[title] "Save"',
      '[نص ظاهر] "حفظ PDF"',
      '[قيمة داخلية معروضة كما هي] notification.type',
      '[placeholder] "07xxxxxxxx"',
      '[toast.success] "KB"',
      '[رسالة خطأ] "Failed to save"'
    ]);
  });
});
