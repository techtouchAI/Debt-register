import { cp, mkdir, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = resolve(root, 'dist');
const out = resolve(root, 'desktop/src-tauri/dist');
try {
  await access(resolve(src, 'index.html'));
} catch {
  console.error('dist/index.html not found — run `npm run build` in the repo root first (or use the npm scripts in desktop/ which build it automatically).');
  process.exit(1);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });
console.log(`Prepared built app from ${src} in ${out}`);
