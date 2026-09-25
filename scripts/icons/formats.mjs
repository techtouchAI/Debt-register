/**
 * ترميز صيغ الأيقونات بلا اعتماديات خارجية (zlib من Node فقط):
 *   - PNG: من بكسلات RGBA؛ تُسقط قناة الشفافية تلقائياً إن كانت الصورة معتمة
 *     بالكامل (ملف أصغر، وأيقونات iOS ترفض قناة الشفافية).
 *   - ICO (ويندوز): الأحجام الصغيرة BMP بعمق 32 بت (أوسع توافقاً مع Explorer
 *     ومحرر الموارد وNSIS)، والكبيرة PNG لتبقى الأيقونة خفيفة.
 *   - ICNS (ماك): مدخلات PNG بالأحجام القياسية (16 حتى 1024).
 * وقارئ مختصر لترويسة PNG/ICO تستخدمه الاختبارات للتحقق من الأبعاد.
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * يحوّل بكسلات مضروبة مسبقاً بالشفافية (ما يُرجعه resvg) إلى RGBA عادي
 * كما تتطلبه PNG وBMP.
 */
export function unpremultiply(pixels) {
  const out = Buffer.from(pixels);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3];
    if (alpha === 0) {
      out[i] = out[i + 1] = out[i + 2] = 0;
    } else if (alpha < 255) {
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round((out[i + c] * 255) / alpha));
    }
  }
  return out;
}

/**
 * PNG من بكسلات RGBA عادية. مرشّح لكل سطر بأقل مجموع فروق مطلقة (طريقة
 * libpng) ثم ضغط zlib بأعلى مستوى — ملفات أصغر من مخرجات resvg المباشرة.
 */
export function encodePng(width, height, rgba) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const bpp = opaque ? 3 : 4;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * stride);
  for (let src = 0, dst = 0; src < rgba.length; src += 4) {
    raw[dst++] = rgba[src];
    raw[dst++] = rgba[src + 1];
    raw[dst++] = rgba[src + 2];
    if (!opaque) raw[dst++] = rgba[src + 3];
  }

  const filtered = Buffer.alloc(height * (stride + 1));
  const zeros = Buffer.alloc(stride);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : zeros;
    let best = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      const out = candidates[filter];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = up[i];
        const c = i >= bpp ? up[i - bpp] : 0;
        const predictor =
          filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const value = (line[i] - predictor) & 0xff;
        out[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
      }
    }
    filtered[y * (stride + 1)] = best;
    candidates[best].copy(filtered, y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // عمق 8 بت لكل قناة
  header[9] = opaque ? 2 : 6; // RGB أو RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/** صورة DIB بعمق 32 بت داخل ICO: BGRA من الأسفل للأعلى + قناع AND أحادي البت. */
function icoBitmap(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // الارتفاع مضاعف: صورة الألوان + القناع
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // DIB يبدأ من السطر الأخير
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = (row * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
      if (rgba[src + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}

/**
 * ملف ICO متعدد الأحجام.
 * @param {{ size: number, rgba: Buffer, png: Buffer }[]} images
 * @param {{ bmpMaxSize?: number }} options الأحجام حتى هذا الحد تُكتب BMP والباقي PNG
 */
export function encodeIco(images, { bmpMaxSize = 48 } = {}) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const blobs = sorted.map((image) => (image.size <= bmpMaxSize ? icoBitmap(image.size, image.rgba) : image.png));
  const directory = Buffer.alloc(6 + 16 * sorted.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // النوع 1 = أيقونة
  directory.writeUInt16LE(sorted.length, 4);
  let offset = directory.length;
  sorted.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size; // 0 تعني 256
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory.writeUInt16LE(1, entry + 4); // المستويات
    directory.writeUInt16LE(32, entry + 6); // بت لكل بكسل
    directory.writeUInt32LE(blobs[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += blobs[index].length;
  });
  return Buffer.concat([directory, ...blobs]);
}

/** رموز ICNS لمدخلات PNG وحجم كل منها بالبكسل. */
export const ICNS_TYPES = [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024]
];

/** ملف ICNS من صور PNG مفهرسة بالحجم: `pngBySize.get(1024)` … */
export function encodeIcns(pngBySize) {
  const entries = ICNS_TYPES.map(([type, size]) => {
    const png = pngBySize.get(size);
    if (!png) throw new Error(`ICNS يحتاج صورة ${size}×${size}`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

/** أبعاد PNG ونوع ألوانه من الترويسة (للتحقق في الاختبارات والتدقيق). */
export function readPngInfo(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    hasAlpha: buffer[25] === 6 || buffer[25] === 4
  };
}

/** أحجام الصور داخل ملف ICO وصيغة كل منها. */
export function readIcoEntries(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = buffer[entry] || 256;
    const offset = buffer.readUInt32LE(entry + 12);
    const format = buffer.subarray(offset, offset + 8).equals(PNG_SIGNATURE) ? 'png' : 'bmp';
    entries.push({ size, format });
  }
  return entries;
}

/** رموز المدخلات داخل ملف ICNS. */
export function readIcnsTypes(buffer) {
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'icns') return null;
  const types = [];
  for (let offset = 8; offset + 8 <= buffer.length; ) {
    types.push(buffer.toString('ascii', offset, offset + 4));
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8) break;
    offset += length;
  }
  return types;
}
