/**
 * هندسة الصور الظلية أحادية اللون لأيقونات أندرويد (VectorDrawable):
 *   - طبقة monochrome للأيقونة التكيفية (الأيقونات ذات السمة، أندرويد 13+).
 *   - أيقونة الإشعارات في شريط الحالة (ic_stat_agri).
 *
 * VectorDrawable لا يملك عمليات قصّ بين الأشكال، لذلك تُبنى الفتحات (أسطر
 * الوصل، الفراغ حول الختم، علامة الصح) هندسياً: الحدود الخارجية مع عقارب
 * الساعة والفتحات عكسها، فتعمل الفتحات بقاعدتي evenOdd وnonZero معاً.
 */

const round = (value) => Math.round(value * 100) / 100;
const point = ([x, y]) => `${round(x)},${round(y)}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const unit = (a) => scale(a, 1 / Math.hypot(a[0], a[1]));

/** مساحة مضلع بإشارة (إحداثيات الشاشة: موجبة = مع عقارب الساعة بصرياً). */
function signedArea(points) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

/** أول تقاطع للقطعة AB مع دائرة (المركز C ونصف القطر R) بدءاً من A. */
function segmentCircleHit(A, B, C, R) {
  const d = sub(B, A);
  const f = sub(A, C);
  const a = dot(d, d);
  const b = 2 * dot(f, d);
  const c = dot(f, f) - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t >= 0 && t <= 1) return add(A, scale(d, t));
  }
  return null;
}

/**
 * الوصل: زاويتان علويتان مستديرتان وحافة سفلية مسننة، مع «ثلمة» دائرية
 * (فراغ) حول الختم في الزاوية السفلى اليسرى. الاتجاه مع عقارب الساعة.
 */
export function receiptOutline({ x0, x1, top, base, teeth, depth, radius, notch }) {
  const { cx, cy, r } = notch;
  const toothWidth = (x1 - x0) / teeth;
  const zigzag = [[x1, base]];
  for (let i = 0; i < teeth; i++) {
    const right = x1 - i * toothWidth;
    zigzag.push([right - toothWidth / 2, base + depth], [right - toothWidth, base]);
  }
  const dx = x0 - cx;
  if (Math.abs(dx) >= r) throw new Error('الفراغ حول الختم لا يقطع الحافة اليسرى للوصل');
  const leftHit = [x0, cy - Math.sqrt(r * r - dx * dx)];
  let bottomHit = null;
  let lastVertex = 0;
  for (let i = 0; i < zigzag.length - 1 && !bottomHit; i++) {
    bottomHit = segmentCircleHit(zigzag[i], zigzag[i + 1], [cx, cy], r);
    lastVertex = i;
  }
  if (!bottomHit) throw new Error('الفراغ حول الختم لا يقطع الحافة المسننة للوصل');

  let d = `M${point(leftHit)} V${round(top + radius)} Q${point([x0, top])} ${point([x0 + radius, top])}`;
  d += ` H${round(x1 - radius)} Q${point([x1, top])} ${point([x1, top + radius])} V${round(base)}`;
  for (let i = 1; i <= lastVertex; i++) d += ` L${point(zigzag[i])}`;
  // القوس يعود إلى نقطة البداية عبر داخل الوصل (عكس عقارب الساعة حول مركز الختم)
  d += ` L${point(bottomHit)} A${round(r)},${round(r)} 0 0,0 ${point(leftHit)} Z`;
  return d;
}

/** سطر نصي بحواف نصف دائرية — فتحة (عكس عقارب الساعة). */
export function pillHole(x, y, width, height) {
  const r = height / 2;
  const rr = `${round(r)},${round(r)}`;
  return (
    `M${point([x + width - r, y])} H${round(x + r)} A${rr} 0 0,0 ${point([x + r, y + height])}` +
    ` H${round(x + width - r)} A${rr} 0 0,0 ${point([x + width - r, y])} Z`
  );
}

/** دائرة ممتلئة (مع عقارب الساعة). */
export function disc(cx, cy, r) {
  const rr = `${round(r)},${round(r)}`;
  return `M${point([cx - r, cy])} A${rr} 0 1,1 ${point([cx + r, cy])} A${rr} 0 1,1 ${point([cx - r, cy])} Z`;
}

/**
 * محيط خط منكسر سميك بنهايتين ووصلة مستديرة (علامة صح) — فتحة (عكس عقارب
 * الساعة) لتُقص من قرص الختم.
 */
export function checkHole(P0, P1, P2, width) {
  const h = width / 2;
  const d1 = unit(sub(P1, P0));
  const d2 = unit(sub(P2, P1));
  const n1 = [-d1[1], d1[0]];
  const n2 = [-d2[1], d2[0]];
  const outer = dot(n1, d2) < 0 ? 1 : -1; // جهة الانكسار الخارجية (تُستدار)
  const oA = add(P0, scale(n1, outer * h));
  const oB = add(P1, scale(n1, outer * h));
  const oC = add(P1, scale(n2, outer * h));
  const oD = add(P2, scale(n2, outer * h));
  const iD = add(P2, scale(n2, -outer * h));
  const iA = add(P0, scale(n1, -outer * h));
  const t = cross(sub(add(P1, scale(n2, -outer * h)), iA), d2) / cross(d1, d2);
  const inner = add(iA, scale(d1, t)); // تقاطع الحافتين الداخليتين
  const capSweep = outer < 0 ? 1 : 0;
  const joinSweep = cross(d1, d2) > 0 ? 1 : 0;
  const hr = `${round(h)},${round(h)}`;
  // المقاطع بالترتيب الأمامي؛ تُعكس إن لزم ليكون الاتجاه عكس عقارب الساعة
  const segments = [
    { to: oB, arc: null },
    { to: oC, arc: joinSweep },
    { to: oD, arc: null },
    { to: iD, arc: capSweep },
    { to: inner, arc: null },
    { to: iA, arc: null },
    { to: oA, arc: capSweep }
  ];
  let start = oA;
  let path = segments;
  if (signedArea([oA, oB, oC, oD, iD, inner, iA]) > 0) {
    const vertices = [oA, ...segments.map((segment) => segment.to)];
    path = segments
      .map((segment, index) => ({ to: vertices[index], arc: segment.arc === null ? null : 1 - segment.arc }))
      .reverse();
    start = oA;
  }
  let d = `M${point(start)}`;
  for (const segment of path) {
    d += segment.arc === null ? ` L${point(segment.to)}` : ` A${hr} 0 0,${segment.arc} ${point(segment.to)}`;
  }
  return `${d} Z`;
}

/**
 * صورة ظلية للرمز: مساران (الوصل بأسطره المفرّغة + الختم بعلامة صح مفرّغة).
 * الإحداثيات بوحدات الإطار الهدف مباشرة.
 */
export function receiptSilhouette({ receipt, lines, seal }) {
  const paper = [
    receiptOutline({ ...receipt, notch: { cx: seal.cx, cy: seal.cy, r: seal.r + seal.gap } }),
    ...lines.map(([x, y, width, height]) => pillHole(x, y, width, height))
  ].join(' ');
  const [a, b, c] = seal.check;
  const stamp = `${disc(seal.cx, seal.cy, seal.r)} ${checkHole(a, b, c, seal.checkWidth)}`;
  return { paper, stamp };
}

/**
 * يحوّل مواصفات بإحداثيات لوحة الرسم 1024 إلى إطار آخر (تكبير + إزاحة):
 * مثلاً طبقة أندرويد 108dp حيث يقابل الرسم الكامل الإطار المرئي 72dp.
 */
export function mapSpec(spec, factor, offsetX, offsetY) {
  const x = (value) => offsetX + value * factor;
  const y = (value) => offsetY + value * factor;
  const l = (value) => value * factor;
  const { receipt, lines, seal } = spec;
  return {
    receipt: {
      x0: x(receipt.x0),
      x1: x(receipt.x1),
      top: y(receipt.top),
      base: y(receipt.base),
      teeth: receipt.teeth,
      depth: l(receipt.depth),
      radius: l(receipt.radius)
    },
    lines: lines.map(([lx, ly, width, height]) => [x(lx), y(ly), l(width), l(height)]),
    seal: {
      cx: x(seal.cx),
      cy: y(seal.cy),
      r: l(seal.r),
      gap: l(seal.gap),
      check: seal.check.map(([px, py]) => [x(px), y(py)]),
      checkWidth: l(seal.checkWidth)
    }
  };
}
